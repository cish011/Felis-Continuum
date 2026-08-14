import * as THREE from 'three';
import './styles.css';
import defaultProfile from './data/cat-profile.json';
import { COATS, EYE_COLORS, PERSONALITIES } from './data/catalog.js';
import { clamp } from './core/math.js';
import { events } from './core/events.js';
import { HabitatRenderer } from './rendering/renderer.js';
import { CameraRig } from './rendering/camera.js';
import { DebugVisualizer } from './rendering/debug-visualizer.js';
import { SimulationUI } from './ui/interface.js';
import { CatAudio } from './audio/synth.js';
import { ContextInteraction } from './interaction/context-interaction.js';
import { createEnvironment } from './simulation/environment.js';
import { ToyPhysics } from './simulation/physics.js';
import { CatModel } from './simulation/cat-model.js';
import { ProceduralLocomotion } from './simulation/locomotion.js';
import { CognitionBridge } from './simulation/cognition.js';
import { GoalExecutor } from './simulation/goal-executor.js';

const FIXED_STEP = 1 / 60;
const COGNITION_STEP = 1 / 8;
const START_POSITION = new THREE.Vector3(-7.2, 0, -5.25);
const PET_PREFERENCE = Object.freeze({
  head:.92, cheek:1, muzzle:.72, ear:.62, neck:.86, chest:.64,
  back:.75, torso:.62, side:.58, rump:.67, belly:.18, tail:.24,
  paw:.12, frontLeg:.34, hindLeg:.28,
});

const ui = new SimulationUI(structuredClone(defaultProfile));
const audio = new CatAudio();

bootstrap().catch(error => {
  console.error('Felis Continuum failed to initialize', error);
  ui.loadingStatus('The habitat could not be assembled. See the developer console.');
});

async function bootstrap() {
  ui.loadingStatus('Constructing the lived-in habitat…');
  const view = new HabitatRenderer(document.querySelector('#viewport'));
  const environment = createEnvironment(view.scene);

  ui.loadingStatus('Starting fixed-step physical objects…');
  const toyPhysics = await ToyPhysics.create(view.scene, environment, { preferRapier:true, fixedStep:1/120, maxSubsteps:8 });
  toyPhysics.spawnDefaultSet();

  ui.loadingStatus('Assembling anatomy, coat, and layered fur…');
  let profile = structuredClone(defaultProfile);
  const cat = new CatModel(profile);
  view.scene.add(cat.root);
  const locomotion = new ProceduralLocomotion(environment, {
    position:START_POSITION,
    heading:.72,
    bodyScale:profile.bodySize,
    bodyHeight:.46 * profile.bodySize,
  });
  const executor = new GoalExecutor({ locomotion, environment, toyPhysics, events });
  const cameraRig = new CameraRig(view.camera, view.renderer.domElement, environment);
  const diagnostics = new DebugVisualizer(view.scene);

  let cognitionSnapshot = null;
  const cognition = new CognitionBridge({ traits:profile.traits, now:0 }, snapshot => {
    cognitionSnapshot = snapshot;
  });
  const interaction = new ContextInteraction({ camera:view.camera, domElement:view.renderer.domElement, ui, cameraRig });
  refreshInteractionSources();

  const simulation = {
    view, environment, toyPhysics, cat, locomotion, executor, cameraRig,
    diagnostics, cognition, interaction,
    get cognitionSnapshot() { return cognitionSnapshot; },
  };
  window.__FELIS__ = simulation;

  let elapsed = 0;
  let accumulator = 0;
  let cognitionAccumulator = COGNITION_STEP;
  let previous = performance.now() / 1000;
  let executorState = {
    motion:locomotion.getMotionState(), activity:'observe', progress:0,
    distanceToTarget:Infinity, facingTarget:0, goalComplete:false, goalImpossible:false,
  };
  let heldCat = false;
  let heldBody = null;
  let petState = null;
  let callPulse = 0;
  let entered = false;
  let fpsSmooth = 60;
  const transientPercepts = [];
  const cleanups = [];

  bindApplicationEvents();
  ui.finishLoading();
  requestAnimationFrame(frame);

  function frame(nowMs) {
    const now = nowMs / 1000;
    const frameDt = Math.min(.1, Math.max(0, now - previous));
    previous = now;
    accumulator = Math.min(.2, accumulator + frameDt);
    fpsSmooth += ((frameDt > .0001 ? 1/frameDt : 60) - fpsSmooth) * (1 - Math.exp(-2 * frameDt));
    while (accumulator >= FIXED_STEP) {
      fixedUpdate(FIXED_STEP);
      accumulator -= FIXED_STEP;
    }

    const motion = executorState.motion ?? locomotion.getMotionState();
    cat.update(motion, { ...(cognitionSnapshot ?? {}), pet:petState, held:heldCat }, frameDt, elapsed);
    cameraRig.update(frameDt, motion);
    if (heldBody) updateHeldToy(heldBody);
    const hour = (8.15 + elapsed / 135) % 24;
    view.updateDaylight(hour);
    ui.setClock(hour);
    const surface = environment.sampleSurface(motion.position.x, motion.position.z);
    ui.update(cognitionSnapshot, motion, { fps:fpsSmooth, surface:surface?.type ?? surface?.surface?.type ?? 'floor' });
    diagnostics.update(motion, cognitionSnapshot, executor.getPath?.() ?? locomotion.getPath());
    view.render();
    requestAnimationFrame(frame);
  }

  function fixedUpdate(dt) {
    elapsed += dt;
    callPulse = Math.max(0, callPulse - dt * 1.5);
    for (let index=transientPercepts.length-1; index>=0; index--) {
      transientPercepts[index].life -= dt;
      if (transientPercepts[index].life <= 0) transientPercepts.splice(index,1);
    }
    environment.update(dt, elapsed);
    toyPhysics.update(dt, elapsed);

    if (heldCat) executorState = heldCatMotion(dt);
    else executorState = executor.update(dt, cognitionSnapshot);

    const motion = executorState.motion ?? locomotion.getMotionState();
    cognitionAccumulator += dt;
    if (cognitionAccumulator >= COGNITION_STEP) {
      cognitionAccumulator %= COGNITION_STEP;
      cognition.feedback({
        progress:executorState.progress ?? 0,
        distanceToTarget:executorState.distanceToTarget,
        facingTarget:executorState.facingTarget ?? 0,
        goalComplete:Boolean(executorState.goalComplete),
        goalImpossible:Boolean(executorState.goalImpossible),
      });
      cognition.tick(buildCognitionInput(motion, executorState.activity));
    }
  }

  function buildCognitionInput(motion, activity) {
    const objects = [];
    for (const item of environment.getPerceptionObjects()) objects.push(serializePercept(item));
    for (const item of toyPhysics.getPerceptionObjects()) objects.push(serializePercept({ ...item, type:'toy', subtype:item.type }));
    const cameraPosition = view.camera.position;
    objects.push({
      id:'player', type:'player', label:'the player',
      position:{ x:cameraPosition.x, y:cameraPosition.y, z:cameraPosition.z },
      sound:callPulse, hearingRange:20, visibleRange:12,
      urgent:callPulse * .35, valence:.72, accessible:true,
    });
    for (const event of transientPercepts) objects.push(serializePercept(event));
    if (heldBody?.type === 'treat') {
      const position = heldPosition();
      objects.push({ id:'held-treat', type:'treat', label:'a held treat', position, valence:1, urgent:.38, visibleRange:10, accessible:true });
    }

    const playerDistance = motion.position.distanceTo(view.camera.position);
    const room = environment.roomAt(motion.position);
    return {
      now:elapsed,
      cat:{
        position:{x:motion.position.x,y:motion.position.y,z:motion.position.z},
        heading:motion.heading,
        intensity:clamp((motion.speed ?? 0)/4),
        warmth:room === 'garden' ? .56 : room === 'living-room' ? .72 : .64,
        security:room === 'garden' ? .58 : .79,
        playerNear:1-clamp(playerDistance/8),
        activity:activity ?? 'observe',
      },
      objects,
      world:{
        foodLevel:environment.resources?.food?.fullness ?? 1,
        waterLevel:environment.resources?.water?.fullness ?? 1,
        litterCleanliness:environment.resources?.litter?.cleanliness ?? 1,
        doorOpen:[...environment.doors?.values?.() ?? []].some(door => door.open),
        hour:(8.15 + elapsed/135)%24,
        room,
      },
    };
  }

  function serializePercept(item) {
    const position = item.position ?? item.source?.position ?? {x:0,y:0,z:0};
    const velocity = item.velocity;
    const speed = Number.isFinite(item.speed) ? item.speed : velocity?.length?.() ?? Math.hypot(velocity?.x ?? 0, velocity?.z ?? 0);
    return {
      id:String(item.id ?? `percept-${objectsSeed++}`),
      type:item.type ?? item.kind ?? 'unknown',
      label:item.label ?? item.type ?? item.kind ?? 'something',
      position:{x:position.x ?? 0,y:position.y ?? 0,z:position.z ?? 0},
      speed, moving:Boolean(item.moving ?? speed > .05),
      sound:Number(item.sound ?? 0), hearingRange:item.hearingRange,
      visibleRange:item.visibleRange, urgent:Number(item.urgent ?? 0),
      valence:Number(item.valence ?? item.utility ?? .5),
      accessible:item.accessible !== false,
    };
  }

  function heldCatMotion(dt) {
    const point = heldPosition();
    const rootPoint = new THREE.Vector3(point.x, point.y - .43 * profile.bodySize, point.z);
    locomotion.position.lerp(rootPoint, 1-Math.exp(-12*dt));
    locomotion.velocity.set(0,0,0);
    locomotion.speed = 0;
    locomotion.clearTarget();
    const motion = locomotion.getMotionState();
    motion.position.copy(locomotion.position);
    motion.gait = 'held'; motion.speed = 0; motion.crouch = .2;
    return { motion, activity:'social', progress:.25, distanceToTarget:0, facingTarget:1, goalComplete:false, goalImpossible:false };
  }

  function heldPosition() {
    const direction = new THREE.Vector3();
    view.camera.getWorldDirection(direction);
    const right = new THREE.Vector3().crossVectors(direction, view.camera.up).normalize();
    return view.camera.position.clone().addScaledVector(direction,.72).addScaledVector(right,.16).add(new THREE.Vector3(0,-.18,0));
  }

  function updateHeldToy(item) {
    if (item.type !== 'toy' || !item.body) return;
    toyPhysics.hold(item.body, heldPosition());
  }

  function refreshInteractionSources() {
    interaction.setSources(
      cat.getPettableMeshes(),
      environment.interactables.map(item => item.object),
      toyPhysics.toys.map(body => body.mesh),
    );
  }

  function bindApplicationEvents() {
    cleanups.push(events.on('enter', () => { entered=true; audio.enable(); ui.noteActivity(); }));
    cleanups.push(events.on('camera', ({mode}) => cameraRig.setMode(mode)));
    cleanups.push(events.on('debug', ({enabled}) => {
      diagnostics.setEnabled(enabled); cat.setDebug?.(enabled);
    }));
    cleanups.push(events.on('profile', ({profile:next}) => applyProfile(next)));
    cleanups.push(events.on('randomize-cat', randomizeCat));
    cleanups.push(events.on('pet-start', data => {
      if (heldCat) return;
      petState={active:true,part:data.part,intensity:.2,duration:0,point:data.point};
    }));
    cleanups.push(events.on('pet-stroke', data => {
      if (!petState) return;
      const preference=PET_PREFERENCE[data.part] ?? .5;
      petState={...petState,part:data.part,intensity:clamp(.25+data.speed*.7),duration:petState.duration+data.dt,point:data.point,preference};
      cognition.event('pet',clamp(.18+data.speed*.2),{preference,part:data.part},elapsed);
      audio.setPurring(preference>.62 && (cognitionSnapshot?.needs?.stress ?? 0)<.45,preference);
    }));
    cleanups.push(events.on('pet-end', ({duration,part}) => {
      const preference=PET_PREFERENCE[part] ?? .5;
      if(duration>.45 && preference>.6) ui.toast(`${profile.name} leans subtly into the last stroke.`);
      petState={active:false,part,intensity:0,duration};
      audio.setPurring(false);
      setTimeout(()=>{ if(!petState?.active) petState=null; },300);
    }));
    cleanups.push(events.on('world-interaction', handleWorldInteraction));

    const keyHandler = event => {
      if (event.code === 'KeyQ' && !event.repeat && !/INPUT|SELECT|TEXTAREA/.test(event.target?.tagName ?? '')) {
        callPulse=1; audio.whistle();
        addTransient('player-call','sound','A familiar whistle',view.camera.position,.9,2.2);
        ui.toast(`You whistle softly for ${profile.name}.`);
      }
    };
    window.addEventListener('keydown',keyHandler);
    cleanups.push(()=>window.removeEventListener('keydown',keyHandler));
    window.addEventListener('beforeunload',dispose,{once:true});
  }

  function handleWorldInteraction({action,target,held,ray}) {
    if (action?.startsWith('toggle-door:')) {
      const id=action.slice('toggle-door:'.length);
      const open=environment.toggleDoor(id);
      const position=findInteractable(id)?.position ?? view.camera.position;
      addTransient(`door-sound-${elapsed}`,'sound',open?'Door opening':'Door closing',position,.58,1.4);
      cognition.event('startle',.12,{position:plain(position)},elapsed);
      ui.toast(open?'The garden door swings open.':'The door closes with a soft latch.');
    } else if(action==='refill:food') {
      environment.refill('food'); ui.toast('Food settles into the ceramic bowl.');
    } else if(action==='refill:water') {
      environment.refill('water'); ui.toast('The water bowl is fresh again.');
    } else if(action==='clean-litter') {
      environment.cleanLitter(); ui.toast('The litter tray is clean.');
    } else if(action==='dispense-treat') {
      const record=findInteractable('treat-jar');
      if(record?.action?.()) {
        heldBody={type:'treat',label:'Single treat'};
        interaction.setHeld(heldBody);
        ui.toast('A treat is held near the reticle.');
      } else ui.toast('The treat jar is empty.');
    } else if(action==='pickup-toy') {
      const body=toyPhysics.toys.find(item=>item.id===target?.toyId || item.mesh===target?.object || target?.object?.parent===item.mesh) ?? toyPhysics.toys.find(item=>target?.object && item.mesh.getObjectById(target.object.id));
      if(body) {
        toyPhysics.hold(body,heldPosition());
        heldBody={type:'toy',label:body.label,body};
        interaction.setHeld(heldBody);
      }
    } else if(action==='throw-held' && heldBody?.type==='toy') {
      const direction=ray?.direction?.clone?.() ?? new THREE.Vector3();
      if(!direction.lengthSq()) view.camera.getWorldDirection(direction);
      const origin=heldPosition();
      const velocity=direction.normalize().multiplyScalar(5.4).add(new THREE.Vector3(0,1.15,0));
      toyPhysics.toss(heldBody.body,{position:origin,velocity,spin:new THREE.Vector3(4,7,-5)});
      addTransient(`toy-flight-${elapsed}`,'sound','A toy skitters away',origin,.32,1);
      heldBody=null; interaction.setHeld(null); refreshInteractionSources();
    } else if((action==='drop-held'||action==='cancel-held') && heldBody) {
      if(heldBody.type==='toy') toyPhysics.release(heldBody.body,new THREE.Vector3());
      if(heldBody.type==='cat') dropCat();
      heldBody=null; interaction.setHeld(null);
    } else if(action==='offer-treat' && heldBody?.type==='treat') {
      const distance=executorState.motion.position.distanceTo(view.camera.position);
      if(distance<2.2) {
        cognition.event('treat',.8,{position:plain(executorState.motion.position)},elapsed);
        cognition.event('reassure',.3,{},elapsed);
        heldBody=null; interaction.setHeld(null); audio.chirp();
        ui.toast(`${profile.name} takes the treat and chews deliberately.`);
      } else ui.toast(`${profile.name} is too far away to take it.`);
    } else if(action==='present-held' && heldBody?.type==='toy') {
      const catPosition=executorState.motion.position;
      toyPhysics.toss(heldBody.body,{position:catPosition.clone().add(new THREE.Vector3(.55,.35,.4)),velocity:new THREE.Vector3(.6,.5,.4)});
      heldBody=null; interaction.setHeld(null); refreshInteractionSources();
    } else if(action==='pickup-cat') {
      attemptCatPickup();
    } else if(action?.startsWith('interact:')) {
      const id=action.slice('interact:'.length);
      const record=findInteractable(id);
      addTransient(`touch-${id}-${elapsed}`,'unknown',`Movement at ${record?.label ?? id}`,record?.position ?? view.camera.position,.28,1.2);
      ui.toast(`${record?.label ?? 'The object'} shifts slightly under your hand.`);
    }
  }

  function attemptCatPickup() {
    const motion=executorState.motion;
    const distance=motion.position.distanceTo(view.camera.position);
    const stress=cognitionSnapshot?.needs?.stress ?? .2;
    const fear=cognitionSnapshot?.needs?.fear ?? 0;
    if(distance>2.1) return ui.toast(`${profile.name} is out of reach.`);
    if(motion.speed>.35 || stress>.58 || fear>.48) {
      cognition.event('startle',.2,{position:plain(motion.position)},elapsed);
      return ui.toast(`${profile.name} steps away from the reaching hands.`);
    }
    heldCat=true;
    heldBody={type:'cat',label:profile.name};
    interaction.setHeld(heldBody);
    executor.interrupt?.('pickup',{position:heldPosition()});
    cognition.event('pet',.2,{preference:.55,part:'chest'},elapsed);
    ui.toast(`You support ${profile.name} beneath chest and hindquarters.`);
  }

  function dropCat() {
    if(!heldCat) return;
    const ahead=heldPosition();
    const surface=environment.sampleSurface(ahead.x,ahead.z,{referenceY:ahead.y,maxStep:Infinity});
    locomotion.position.set(ahead.x,surface?.height ?? 0,ahead.z);
    locomotion.velocity.set(0,0,0); locomotion.speed=0;
    heldCat=false;
    cognition.event('reassure',.18,{},elapsed);
  }

  function findInteractable(id) { return environment.interactables.find(item=>item.id===id); }

  function addTransient(id,type,label,position,sound=.3,life=1) {
    transientPercepts.push({id,type,label,position:plain(position),sound,urgent:sound*.5,visibleRange:9,hearingRange:18,valence:.45,accessible:true,life});
  }

  function applyProfile(next) {
    profile=structuredClone(next);
    cat.applyProfile(profile);
    cognition.setPersonality(profile.traits);
    locomotion.bodyScale=profile.bodySize;
    locomotion.neutralBodyHeight=.46*profile.bodySize;
    refreshInteractionSources();
  }

  function randomizeCat() {
    const coats=Object.keys(COATS), eyes=Object.keys(EYE_COLORS), temperaments=Object.keys(PERSONALITIES);
    const temperament=temperaments[Math.floor(Math.random()*temperaments.length)];
    const names=['Morrow','Sable','Pip','Juniper','Nori','Tansy','Orbit','Mica'];
    const next={
      ...profile,
      name:names[Math.floor(Math.random()*names.length)],
      coat:coats[Math.floor(Math.random()*coats.length)],
      eyeColor:eyes[Math.floor(Math.random()*eyes.length)],
      furLength:.08+Math.random()*.85,
      bodySize:.86+Math.random()*.28,
      personality:temperament,
      traits:{...PERSONALITIES[temperament].traits},
      collar:Math.random()>.25,
    };
    ui.applyProfile(next); applyProfile(next); ui.toast(`${next.name} now has an original new individual profile.`);
  }

  function plain(vector) { return {x:vector?.x??0,y:vector?.y??0,z:vector?.z??0}; }

  function dispose() {
    cleanups.forEach(cleanup=>cleanup?.());
    interaction.dispose(); cognition.dispose(); executor.dispose?.(); diagnostics.dispose();
    cameraRig.dispose(); cat.dispose(); toyPhysics.dispose(); environment.dispose(); view.dispose();
    delete window.__FELIS__;
  }
}

let objectsSeed=1;
