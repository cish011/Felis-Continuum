import * as THREE from 'three';

const DEFAULT_BOUNDS = Object.freeze({ minX:-12.84, maxX:12.84, minY:-1, maxY:8, minZ:-19.78, maxZ:9.84 });
const BALL_COLORS = [0xd75d4a, 0x4f88a9, 0xe0b64d, 0x6a9b72, 0x8c6fac];

/**
 * Lightweight rigid-body simulation for cat-scale toys.
 *
 * `new ToyPhysics(scene, environment)` is fully synchronous and uses the
 * deterministic Three.js solver. `await ToyPhysics.create(...)` attempts to
 * initialize Rapier's Rust/WASM core, then transparently falls back to the same
 * solver if WASM is unavailable (offline preview, restrictive CSP, test runner).
 *
 * All distances are metres, velocities metres/second, masses kilograms.
 */
export class ToyPhysics {
  static async create(scene, environment=null, options={}) {
    const simulation = new ToyPhysics(scene, environment, options);
    if (options.preferRapier === false) return simulation;
    await simulation.enableRapier();
    return simulation;
  }

  constructor(scene, environment=null, options={}) {
    if (environment && !environment.obstacles && !environment.sampleSurface && !environment.root) {
      options = environment;
      environment = options.environment || null;
    }
    this.scene = scene || null;
    this.environment = environment || null;
    this.root = new THREE.Group();
    this.root.name = 'Dynamic cat toys';
    this.scene?.add?.(this.root);
    this.toys = [];
    this.bodies = this.toys;
    this.gravity = finiteNumber(options.gravity, -9.81);
    this.bounds = { ...DEFAULT_BOUNDS };
    this.setBounds(options.bounds);
    this.fixedStep = clamp(finiteNumber(options.fixedStep, 1/120), 1/1000, 1/20);
    this.maxSubsteps = Math.round(clamp(finiteNumber(options.maxSubsteps, 8), 1, 32));
    this.time = 0;
    this.backend = 'three-deterministic';
    this.backendError = null;
    this._nextId = 1;
    this._rapier = null;
    this._rapierWorld = null;
    this._rapierEnvironmentColliders = [];
    this._disposed = false;
    this._tmp = {
      closest:new THREE.Vector3(),
      normal:new THREE.Vector3(),
      tangent:new THREE.Vector3(),
      impulse:new THREE.Vector3(),
      point:new THREE.Vector3(),
      axis:new THREE.Vector3(),
      quaternion:new THREE.Quaternion(),
      euler:new THREE.Euler(),
      matrix:new THREE.Matrix4(),
      localPoint:new THREE.Vector3(),
      localClosest:new THREE.Vector3(),
      scale:new THREE.Vector3(),
      delta:new THREE.Vector3(),
      relative:new THREE.Vector3(),
      surfaceVelocity:new THREE.Vector3(),
      contact:new THREE.Vector3(),
    };
  }

  /** Attempt an in-place upgrade to Rapier. Safe to call more than once. */
  async enableRapier() {
    if (this._disposed) return false;
    if (this._rapierWorld) return true;
    try {
      const module = await import('@dimforge/rapier3d-compat');
      const RAPIER = module.default || module;
      await RAPIER.init();
      if (this._disposed) return false;
      this._rapier = RAPIER;
      this._rapierWorld = new RAPIER.World({ x:0, y:this.gravity, z:0 });
      this.backend = 'rapier-wasm';
      this._buildRapierEnvironment();
      for (const body of this.toys) this._attachRapierBody(body);
      return true;
    } catch (error) {
      this.backendError = error;
      this.backend = 'three-deterministic';
      this._rapier = null;
      this._rapierWorld = null;
      return false;
    }
  }

  setEnvironment(environment) {
    this.environment = environment || null;
    if (this._rapierWorld) {
      this._clearRapierEnvironment();
      this._buildRapierEnvironment();
    }
    return this;
  }

  setBounds(bounds) {
    for(const key of Object.keys(DEFAULT_BOUNDS)) {
      if(Number.isFinite(bounds?.[key])) this.bounds[key]=bounds[key];
    }
    if(this.bounds.minX>=this.bounds.maxX) [this.bounds.minX,this.bounds.maxX]=[this.bounds.maxX,this.bounds.minX];
    if(this.bounds.minY>=this.bounds.maxY) [this.bounds.minY,this.bounds.maxY]=[this.bounds.maxY,this.bounds.minY];
    if(this.bounds.minZ>=this.bounds.maxZ) [this.bounds.minZ,this.bounds.maxZ]=[this.bounds.maxZ,this.bounds.minZ];
    return this;
  }

  createBall(position=new THREE.Vector3(-5.9,.2,-3.5), options={}) {
    ({position, options} = normalizeCreateArguments(position, options, [-5.9,.2,-3.5]));
    const radius = clamp(positiveFinite(options.radius,.074),.008,.5);
    const group = new THREE.Group();
    const color = options.color ?? BALL_COLORS[(this._nextId-1) % BALL_COLORS.length];
    const shellMaterial = standardMaterial(color, .54, .02);
    const shell = new THREE.Mesh(new THREE.SphereGeometry(radius, 24, 16), shellMaterial);
    shell.name = 'woven-ball-shell';
    shell.castShadow = true;
    shell.receiveShadow = true;
    group.add(shell);
    // Three recessed-looking rings make spin visible at realistic toy scale.
    const stripeMaterial = standardMaterial(options.stripeColor ?? 0xefe4cf, .72, 0);
    for (const rotation of [[Math.PI/2,0,0],[0,Math.PI/2,0],[Math.PI/4,Math.PI/2,0]]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(radius*1.005, radius*.045, 6, 32), stripeMaterial);
      ring.rotation.set(...rotation);
      ring.castShadow = true;
      group.add(ring);
    }
    const body = this._makeBody('ball', group, position, {
      radius,
      mass:options.mass ?? .038,
      restitution:options.restitution ?? .66,
      friction:options.friction ?? .43,
      linearDrag:options.linearDrag ?? .065,
      angularDrag:options.angularDrag ?? .12,
      gravityScale:1,
      label:options.label || 'Rolling jingle ball',
      phase:options.phase,
    });
    body.visual = shell;
    return body;
  }

  createMouse(position=new THREE.Vector3(-4.75,.16,-.1), options={}) {
    ({position, options} = normalizeCreateArguments(position, options, [-4.75,.16,-.1]));
    const group = new THREE.Group();
    const fur = standardMaterial(options.color ?? 0x7b756d, .96, 0);
    const innerEar = standardMaterial(0xb77e7d, .9, 0);
    const dark = standardMaterial(0x242321, .64, .03);
    const bodyMesh = new THREE.Mesh(new THREE.SphereGeometry(.105,20,14),fur);
    bodyMesh.name='mouse-body'; bodyMesh.scale.set(.82,.68,1.28); bodyMesh.castShadow=true; group.add(bodyMesh);
    const head = new THREE.Mesh(new THREE.SphereGeometry(.072,18,12),fur);
    head.name='mouse-head'; head.position.set(0,.012,.125); head.scale.set(.8,.78,1.05); head.castShadow=true; group.add(head);
    for(const side of [-1,1]) {
      const ear=new THREE.Mesh(new THREE.CircleGeometry(.035,14),innerEar);
      ear.name=`mouse-ear-${side}`; ear.position.set(side*.046,.065,.117); ear.rotation.set(-.18,side*.18,0); group.add(ear);
      const eye=new THREE.Mesh(new THREE.SphereGeometry(.009,9,7),dark);
      eye.name=`mouse-eye-${side}`; eye.position.set(side*.043,.025,.186); group.add(eye);
    }
    const nose=new THREE.Mesh(new THREE.SphereGeometry(.013,10,7),dark); nose.name='mouse-nose'; nose.position.set(0,-.005,.205); group.add(nose);
    const tailCurve=new THREE.CatmullRomCurve3([
      new THREE.Vector3(0,.01,-.12),new THREE.Vector3(.06,.015,-.22),
      new THREE.Vector3(.12,.025,-.32),new THREE.Vector3(.08,.04,-.43),
    ]);
    const tail=new THREE.Mesh(new THREE.TubeGeometry(tailCurve,18,.009,6,false),innerEar);
    tail.name='mouse-tail'; tail.castShadow=true; group.add(tail);
    const lineMaterial=new THREE.LineBasicMaterial({color:0xd7d0c4,transparent:true,opacity:.8});
    for(const side of [-1,1]) for(let i=0;i<3;i++) {
      const points=[new THREE.Vector3(side*.035,-.002,.18),new THREE.Vector3(side*(.12+i*.018),-.006+i*.012,.235+i*.008)];
      const whisker=new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),lineMaterial);
      whisker.name=`mouse-whisker-${side}-${i}`; group.add(whisker);
    }
    const body = this._makeBody('mouse', group, position, {
      radius:clamp(positiveFinite(options.radius,.112),.02,.5),
      mass:options.mass ?? .027,
      restitution:options.restitution ?? .28,
      friction:options.friction ?? .72,
      linearDrag:options.linearDrag ?? .13,
      angularDrag:options.angularDrag ?? .36,
      gravityScale:1,
      label:options.label || 'Cloth prey mouse',
      phase:options.phase,
    });
    body.tail = tail;
    body.visual = bodyMesh;
    return body;
  }

  createFeather(position=new THREE.Vector3(-5.05,.35,-.3), options={}) {
    ({position, options} = normalizeCreateArguments(position, options, [-5.05,.35,-.3]));
    const group = new THREE.Group();
    const shaftMat = standardMaterial(options.shaftColor ?? 0xd6c6a3, .65, 0);
    const vaneMat = standardMaterial(options.color ?? 0x4d7891, .9, 0, {side:THREE.DoubleSide});
    const accentMat = standardMaterial(options.accentColor ?? 0xb95f4e, .88, 0, {side:THREE.DoubleSide});
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(.006,.009,.35,8),shaftMat);
    shaft.name='feather-shaft'; shaft.position.y=-.015; shaft.castShadow=true; group.add(shaft);
    const leftShape=new THREE.Shape();
    leftShape.moveTo(0,-.11); leftShape.bezierCurveTo(-.055,-.07,-.095,.06,-.025,.16); leftShape.lineTo(0,.155); leftShape.lineTo(0,-.11);
    const rightShape=new THREE.Shape();
    rightShape.moveTo(0,-.11); rightShape.bezierCurveTo(.065,-.055,.105,.075,.02,.165); rightShape.lineTo(0,.155); rightShape.lineTo(0,-.11);
    const left=new THREE.Mesh(new THREE.ShapeGeometry(leftShape,10),vaneMat); left.name='feather-vane-left'; left.position.y=.04; left.castShadow=true; group.add(left);
    const right=new THREE.Mesh(new THREE.ShapeGeometry(rightShape,10),accentMat); right.name='feather-vane-right'; right.position.y=.04; right.castShadow=true; group.add(right);
    const thread=new THREE.Mesh(new THREE.CylinderGeometry(.004,.004,.46,6),standardMaterial(0x3a3732,.75,0));
    thread.name='feather-string'; thread.position.y=-.4; group.add(thread);
    const body = this._makeBody('feather', group, position, {
      radius:clamp(positiveFinite(options.radius,.09),.015,.5),
      mass:options.mass ?? .0045,
      restitution:options.restitution ?? .12,
      friction:options.friction ?? .48,
      linearDrag:options.linearDrag ?? 3.2,
      angularDrag:options.angularDrag ?? 1.6,
      gravityScale:options.gravityScale ?? .24,
      label:options.label || 'Loose fluttering feather',
      phase:options.phase,
    });
    body.visual = group;
    body.shaft = shaft;
    body.aeroArea = .015;
    return body;
  }

  /** Create one toy by kind; useful for UI inventories and scripted scenarios. */
  create(kind='ball', position, options={}) {
    if (kind === 'mouse') return this.createMouse(position, options);
    if (kind === 'feather') return this.createFeather(position, options);
    return this.createBall(position, options);
  }

  /** Spawn the authored default trio. Existing toys are preserved. */
  spawnDefaultSet() {
    return [
      this.createBall(new THREE.Vector3(-6.15,.16,-3.05), {color:0xc85a43}),
      this.createMouse(new THREE.Vector3(-4.72,.15,-.22)),
      this.createFeather(new THREE.Vector3(-5.18,.28,-.42), {color:0x4b7895}),
    ];
  }

  _makeBody(type, object, position, options) {
    const id = options.id || `${type}-${this._nextId++}`;
    object.name = id;
    object.position.copy(toVector(position));
    this.root.add(object);
    const interaction = {type:'toy',label:`Pick up ${options.label}`,action:'pickup-toy'};
    object.userData.interaction = interaction;
    object.traverse(child=>{ if(child.isMesh || child.isLine) child.userData.interaction={...interaction,toyId:id,toyType:type}; });
    const radius=positiveFinite(options.radius,.06);
    const mass=positiveFinite(options.mass,.03);
    const body = {
      id,
      type,
      label:options.label,
      mesh:object,
      object,
      position:object.position,
      velocity:new THREE.Vector3(),
      angularVelocity:new THREE.Vector3(),
      radius,
      mass,
      invMass:1/mass,
      restitution:clamp(finiteNumber(options.restitution,.3),0,1),
      friction:clamp(finiteNumber(options.friction,.6),0,2),
      linearDrag:Math.max(0,finiteNumber(options.linearDrag,.1)),
      angularDrag:Math.max(0,finiteNumber(options.angularDrag,.2)),
      gravityScale:clamp(finiteNumber(options.gravityScale,1),0,4),
      phase:finiteNumber(options.phase,(this._nextId*2.399963229728653)%6.283185307179586),
      sleeping:false,
      sleepTimer:0,
      held:false,
      age:0,
      impact:0,
      grounded:false,
      collisions:0,
      lastCollision:null,
      room:this.environment?.roomAt?.(object.position) || 'unknown',
      rapierBody:null,
      rapierCollider:null,
      state:{motion:'resting',speed:0,grounded:false,room:'unknown',lastImpact:0},
    };
    this.toys.push(body);
    if (this._rapierWorld) this._attachRapierBody(body);
    return body;
  }

  /**
   * Toss overloads:
   *   toss(toy, velocity)
   *   toss(toy, origin, velocity)
   *   toss(toy, { position, velocity, spin })
   */
  toss(target, originOrVelocity=new THREE.Vector3(2,3,-1), maybeVelocity) {
    let body=this._resolveBody(target);
    if(!body && typeof target==='string' && ['ball','mouse','feather'].includes(target)) body=this.create(target);
    if(!body) return null;
    let origin=null, velocity=null, spin=null;
    if(originOrVelocity && !originOrVelocity.isVector3 && !Array.isArray(originOrVelocity) && typeof originOrVelocity==='object') {
      origin=originOrVelocity.position ? toVector(originOrVelocity.position) : null;
      velocity=toVector(originOrVelocity.velocity || [2,3,-1]);
      spin=originOrVelocity.spin ? toVector(originOrVelocity.spin) : null;
    } else if(maybeVelocity !== undefined) {
      origin=toVector(originOrVelocity);
      velocity=toVector(maybeVelocity);
    } else velocity=toVector(originOrVelocity);
    if(origin) body.position.copy(origin);
    body.velocity.copy(velocity).clampLength(0,18);
    if(spin) body.angularVelocity.copy(spin).clampLength(0,80);
    else {
      body.angularVelocity.set(
        (Math.sin(body.phase*7.1)*.5+.5)*8,
        (Math.cos(body.phase*3.7)*.5+.5)*5,
        -body.velocity.x/Math.max(body.radius,.03)
      );
    }
    body.sleeping=false; body.sleepTimer=0; body.held=false; body.grounded=false;
    if(body.rapierBody) {
      // `hold` changes the Rapier body to kinematic. A throw must restore the
      // dynamic type before setting velocity or Rapier will ignore the launch.
      body.rapierBody.setBodyType(this._rapier.RigidBodyType.Dynamic,true);
      body.rapierBody.setTranslation(vectorObject(body.position),true);
      body.rapierBody.setLinvel(vectorObject(body.velocity),true);
      body.rapierBody.setAngvel(vectorObject(body.angularVelocity),true);
      body.rapierBody.wakeUp();
    }
    return body;
  }

  /** Apply a paw-sized impulse. A numeric third argument scales a direction. */
  batImpulse(target, impulse=new THREE.Vector3(.038,.014,0), contactPoint=null) {
    const body=this._resolveBody(target);
    if(!body||body.held) return false;
    let applied=toVector(impulse);
    if(typeof contactPoint==='number') applied=applied.normalize().multiplyScalar(contactPoint);
    applied.clampLength(0,.18);
    body.velocity.addScaledVector(applied,body.invMass).clampLength(0,18);
    if(contactPoint && typeof contactPoint!=='number') {
      const lever=toVector(contactPoint).sub(body.position);
      const torque=lever.cross(applied).multiplyScalar(2.5/Math.max(body.mass,.005));
      body.angularVelocity.add(torque).clampLength(0,45);
    } else {
      body.angularVelocity.x+=applied.z*7;
      body.angularVelocity.z-=applied.x*7;
    }
    body.sleeping=false; body.sleepTimer=0;
    if(body.rapierBody) {
      // Synchronize the result computed from the authored toy mass so both
      // backends produce the same paw strike rather than applying it twice.
      body.rapierBody.setLinvel(vectorObject(body.velocity),true);
      body.rapierBody.setAngvel(vectorObject(body.angularVelocity),true);
      body.rapierBody.wakeUp();
    }
    return true;
  }

  hold(target, position) {
    const body=this._resolveBody(target);
    if(!body) return false;
    const wasHeld=body.held;
    body.held=true; body.sleeping=false; body.velocity.set(0,0,0); body.angularVelocity.set(0,0,0);
    if(position) body.position.copy(toVector(position));
    if(body.rapierBody) {
      if(!wasHeld) body.rapierBody.setBodyType(this._rapier.RigidBodyType.KinematicPositionBased,true);
      body.rapierBody.setNextKinematicTranslation(vectorObject(body.position));
    }
    return true;
  }

  release(target, velocity=new THREE.Vector3()) {
    const body=this._resolveBody(target);
    if(!body) return false;
    body.held=false; body.velocity.copy(toVector(velocity)).clampLength(0,18); body.sleeping=false; body.sleepTimer=0;
    if(body.rapierBody) {
      body.rapierBody.setBodyType(this._rapier.RigidBodyType.Dynamic,true);
      body.rapierBody.setTranslation(vectorObject(body.position),true);
      body.rapierBody.setLinvel(vectorObject(body.velocity),true);
      body.rapierBody.setAngvel(vectorObject(body.angularVelocity),true);
      body.rapierBody.wakeUp();
    }
    return true;
  }

  update(dt, time=this.time+dt) {
    if(this._disposed || !Number.isFinite(dt) || dt<=0) return;
    const frameDt=Math.min(dt,.067);
    this.time=Number.isFinite(time)?time:this.time+frameDt;
    const steps=Math.min(this.maxSubsteps,Math.max(1,Math.ceil(frameDt/this.fixedStep)));
    const h=frameDt/steps;
    if(this._rapierWorld) this._updateRapier(h,steps);
    else this._updateDeterministic(h,steps);
    for(const body of this.toys) this._updatePresentation(body,frameDt);
  }

  _updateDeterministic(h, steps) {
    for(let step=0;step<steps;step++) {
      for(const body of this.toys) {
        if(body.held) continue;
        body.age+=h; body.grounded=false; body.collisions=0;
        if(body.sleeping) {
          // Moving doors can displace sleeping toys, and a toy whose support
          // vanished must wake so gravity resumes.
          const hitDynamic=this._resolveObstacles(body,h,true);
          body.grounded=this._resolveGround(body,h,false);
          if(!hitDynamic&&body.grounded) continue;
          body.sleeping=false;
          body.sleepTimer=0;
        }
        this._applyForces(body,h);
        body.position.addScaledVector(body.velocity,h);
        this._integrateOrientation(body,h);
        this._resolveWorldBounds(body,h);
        this._resolveObstacles(body,h);
        this._resolveGround(body,h,true);
        this._updateSleep(body,h);
      }
      this._resolveToyPairs();
    }
  }

  _applyForces(body,h) {
    body.velocity.y+=this.gravity*body.gravityScale*h;
    if(body.type==='feather') {
      const horizontalSpeed=Math.hypot(body.velocity.x,body.velocity.z);
      const flutter=Math.sin(this.time*11.7+body.phase+body.age*3.1);
      body.velocity.x+=Math.cos(body.phase)*flutter*(.42+.12*horizontalSpeed)*h;
      body.velocity.z+=Math.sin(body.phase)*flutter*(.42+.12*horizontalSpeed)*h;
      body.velocity.y+=Math.abs(flutter)*.48*h;
      body.velocity.y=Math.max(body.velocity.y,-2.35);
    }
    const linearAttenuation=Math.exp(-body.linearDrag*h);
    const angularAttenuation=Math.exp(-body.angularDrag*h);
    body.velocity.multiplyScalar(linearAttenuation);
    body.angularVelocity.multiplyScalar(angularAttenuation);
  }

  _integrateOrientation(body,h) {
    const magnitude=body.angularVelocity.length();
    if(magnitude<1e-5) return;
    this._tmp.axis.copy(body.angularVelocity).multiplyScalar(1/magnitude);
    this._tmp.quaternion.setFromAxisAngle(this._tmp.axis,magnitude*h);
    body.mesh.quaternion.premultiply(this._tmp.quaternion).normalize();
  }

  _resolveWorldBounds(body,h) {
    const p=body.position,r=body.radius,b=this.bounds;
    if(p.x-r<b.minX) this._resolvePlane(body,new THREE.Vector3(1,0,0),b.minX-(p.x-r),h,'world-west');
    if(p.x+r>b.maxX) this._resolvePlane(body,new THREE.Vector3(-1,0,0),(p.x+r)-b.maxX,h,'world-east');
    if(p.z-r<b.minZ) this._resolvePlane(body,new THREE.Vector3(0,0,1),b.minZ-(p.z-r),h,'world-south');
    if(p.z+r>b.maxZ) this._resolvePlane(body,new THREE.Vector3(0,0,-1),(p.z+r)-b.maxZ,h,'world-north');
    if(p.y+r>b.maxY) this._resolvePlane(body,new THREE.Vector3(0,-1,0),(p.y+r)-b.maxY,h,'world-ceiling');
    if(p.y<b.minY) {
      p.set(-5.7,.35,-3.4); body.velocity.set(0,0,0); body.angularVelocity.set(0,0,0);
    }
  }

  _resolveObstacles(body,h,onlyDynamic=false) {
    const obstacles=this.environment?.obstacles || [];
    let collided=false;
    for(const obstacle of obstacles) {
      if(!obstacle || obstacle.enabled===false || obstacle.permeability>=1) continue;
      if(onlyDynamic && !obstacle.dynamic) continue;
      if(!onlyDynamic && obstacle.type==='ramp') continue;
      if(obstacle.colliderObject?.isObject3D) collided=this._sphereObjectCollider(body,obstacle.colliderObject,h,obstacle)||collided;
      else if(obstacle.min?.isVector3 && obstacle.max?.isVector3) collided=this._sphereAabb(body,obstacle.min,obstacle.max,h,obstacle)||collided;
      else if(Number.isFinite(obstacle.minX)) {
        const min=this._tmp.point.set(obstacle.minX,obstacle.minY??0,obstacle.minZ);
        const max=this._tmp.axis.set(obstacle.maxX,obstacle.maxY??3,obstacle.maxZ);
        collided=this._sphereAabb(body,min,max,h,obstacle)||collided;
      }
    }
    return collided;
  }

  _sphereObjectCollider(body,object,h,obstacle) {
    const geometry=object.geometry;
    if(!geometry) return false;
    if(!geometry.boundingBox) geometry.computeBoundingBox?.();
    const box=geometry.boundingBox;
    if(!box||box.isEmpty()) return false;
    object.updateWorldMatrix?.(true,false);
    const inverse=this._tmp.matrix.copy(object.matrixWorld).invert();
    const localPoint=this._tmp.localPoint.copy(body.position).applyMatrix4(inverse);
    const scale=this._tmp.scale.setFromMatrixScale(object.matrixWorld);
    const minScale=Math.max(1e-5,Math.min(Math.abs(scale.x),Math.abs(scale.y),Math.abs(scale.z)));
    const localRadius=body.radius/minScale;
    const closest=this._tmp.localClosest.set(
      clamp(localPoint.x,box.min.x,box.max.x),
      clamp(localPoint.y,box.min.y,box.max.y),
      clamp(localPoint.z,box.min.z,box.max.z),
    );
    const normal=this._tmp.normal.copy(localPoint).sub(closest);
    const distanceSq=normal.lengthSq();
    if(distanceSq>localRadius*localRadius) return false;
    let localPenetration;
    if(distanceSq>1e-12) {
      const distance=Math.sqrt(distanceSq);
      normal.multiplyScalar(1/distance);
      localPenetration=localRadius-distance;
    } else {
      const distances=[
        localPoint.x-box.min.x,box.max.x-localPoint.x,
        localPoint.y-box.min.y,box.max.y-localPoint.y,
        localPoint.z-box.min.z,box.max.z-localPoint.z,
      ];
      let face=0;
      for(let i=1;i<6;i++) if(distances[i]<distances[face]) face=i;
      normal.set(0,0,0);
      if(face===0)normal.x=-1; else if(face===1)normal.x=1;
      else if(face===2)normal.y=-1; else if(face===3)normal.y=1;
      else if(face===4)normal.z=-1; else normal.z=1;
      localPenetration=localRadius+Math.max(0,distances[face]);
    }
    normal.transformDirection(object.matrixWorld);
    const contact=this._tmp.contact.copy(closest).applyMatrix4(object.matrixWorld);
    const surfaceVelocity=this._surfaceVelocityAt(obstacle,contact);
    this._resolvePlane(body,normal,localPenetration*minScale+1e-5,h,obstacle.id||obstacle.type||'obstacle',undefined,surfaceVelocity);
    return true;
  }

  _surfaceVelocityAt(obstacle,contact) {
    const velocity=this._tmp.surfaceVelocity.set(0,0,0);
    if(obstacle?.linearVelocity) velocity.add(toVector(obstacle.linearVelocity));
    if(Number.isFinite(obstacle?.angularVelocityY)&&obstacle?.hinge?.isVector3) {
      const rx=contact.x-obstacle.hinge.x;
      const rz=contact.z-obstacle.hinge.z;
      velocity.x+=obstacle.angularVelocityY*rz;
      velocity.z-=obstacle.angularVelocityY*rx;
    }
    return velocity;
  }

  _sphereAabb(body,min,max,h,obstacle) {
    const p=body.position,r=body.radius;
    if(p.x+r<min.x||p.x-r>max.x||p.y+r<min.y||p.y-r>max.y||p.z+r<min.z||p.z-r>max.z) return false;
    const closest=this._tmp.closest.set(
      clamp(p.x,min.x,max.x),clamp(p.y,min.y,max.y),clamp(p.z,min.z,max.z)
    );
    const normal=this._tmp.normal.copy(p).sub(closest);
    const distanceSq=normal.lengthSq();
    if(distanceSq>r*r) return false;
    let penetration;
    if(distanceSq>1e-12) {
      const distance=Math.sqrt(distanceSq);
      normal.multiplyScalar(1/distance);
      penetration=r-distance;
    } else {
      const distances=[p.x-min.x,max.x-p.x,p.y-min.y,max.y-p.y,p.z-min.z,max.z-p.z];
      let face=0;
      for(let i=1;i<6;i++) if(distances[i]<distances[face]) face=i;
      normal.set(0,0,0);
      if(face===0)normal.x=-1; else if(face===1)normal.x=1;
      else if(face===2)normal.y=-1; else if(face===3)normal.y=1;
      else if(face===4)normal.z=-1; else normal.z=1;
      penetration=r+Math.max(0,distances[face]);
    }
    const surfaceVelocity=this._surfaceVelocityAt(obstacle,this._tmp.contact.copy(closest));
    this._resolvePlane(body,normal,penetration+1e-5,h,obstacle.id||obstacle.type||'obstacle',undefined,surfaceVelocity);
    return true;
  }

  _resolveGround(body,h,allowBounce=true) {
    const sampler=this.environment?.sampleSurface;
    let hit=null;
    if(sampler) {
      hit=sampler(body.position.x,body.position.z,{
        referenceY:body.position.y-body.radius,
        maxStep:body.radius*1.75+.045,
        minY:this.bounds.minY,
      });
    } else if(body.position.x>=this.bounds.minX&&body.position.x<=this.bounds.maxX&&body.position.z>=this.bounds.minZ&&body.position.z<=this.bounds.maxZ) {
      hit={y:0,normal:THREE.Object3D.DEFAULT_UP,friction:.8,type:'floor'};
    }
    if(!hit) return false;
    const groundY=hit.y??hit.height??0;
    const bottom=body.position.y-body.radius;
    if(bottom>groundY+.012) return false;
    const sourceNormal=hit.normal?.isVector3?hit.normal:THREE.Object3D.DEFAULT_UP;
    const normal=this._tmp.axis.set(
      finiteNumber(sourceNormal.x,0),
      finiteNumber(sourceNormal.y,1),
      finiteNumber(sourceNormal.z,0),
    );
    if(normal.lengthSq()<1e-8) normal.set(0,1,0); else normal.normalize();
    const vertical=Math.max(.12,normal.y);
    const penetration=(groundY-bottom)/vertical;
    if(penetration>=-.002) {
      const previousRestitution=body.restitution;
      if(!allowBounce||Math.abs(body.velocity.y)<.22) body.restitution=0;
      this._resolvePlane(body,normal,Math.max(0,penetration)+1e-5,h,hit.surface?.id||hit.type||'surface',hit.friction);
      body.restitution=previousRestitution;
      body.grounded=true;
      if(body.type==='ball') {
        const desired=this._tmp.tangent.crossVectors(normal,body.velocity).multiplyScalar(1/Math.max(body.radius,.025));
        body.angularVelocity.lerp(desired,1-Math.exp(-7*h));
      }
      return true;
    }
    return false;
  }

  _resolvePlane(body,normal,penetration,h,id,frictionOverride,surfaceVelocity=null) {
    body.position.addScaledVector(normal,penetration);
    const surface=surfaceVelocity??this._tmp.surfaceVelocity.set(0,0,0);
    const relative=this._tmp.relative.copy(body.velocity).sub(surface);
    const normalSpeed=relative.dot(normal);
    if(normalSpeed<0) {
      const impact=-normalSpeed;
      body.velocity.addScaledVector(normal,-(1+body.restitution)*normalSpeed);
      relative.copy(body.velocity).sub(surface);
      const normalComponent=this._tmp.impulse.copy(normal).multiplyScalar(relative.dot(normal));
      const tangent=this._tmp.tangent.copy(relative).sub(normalComponent);
      const friction=Math.max(0,finiteNumber(frictionOverride,body.friction));
      const reduction=Math.max(0,1-friction*(normal.y>.45?7:3)*h);
      body.velocity.copy(surface).add(normalComponent).add(tangent.multiplyScalar(reduction));
      body.impact=Math.max(body.impact,impact);
      body.state.lastImpact=impact;
    }
    body.collisions++;
    body.lastCollision=id;
    if(surface.lengthSq()>1e-8) {
      body.sleeping=false;
      body.sleepTimer=0;
      body.rapierBody?.wakeUp?.();
    }
  }

  _resolveToyPairs() {
    for(let i=0;i<this.toys.length;i++) for(let j=i+1;j<this.toys.length;j++) {
      const a=this.toys[i],b=this.toys[j];
      if((a.held&&b.held)||!a.position||!b.position) continue;
      const delta=this._tmp.delta.copy(b.position).sub(a.position);
      const radius=a.radius+b.radius;
      const distanceSq=delta.lengthSq();
      if(distanceSq>=radius*radius) continue;
      let distance=Math.sqrt(distanceSq);
      if(distance<1e-8) {
        const sign=((a.id.length+b.id.length+i+j)&1)?1:-1;
        delta.set(sign,0,0);
        distance=0;
      } else delta.multiplyScalar(1/distance);
      const invA=a.held?0:a.invMass;
      const invB=b.held?0:b.invMass;
      const inverseMass=invA+invB;
      if(inverseMass<=0) continue;
      const penetration=Math.max(0,radius-distance-.0002);
      const correction=penetration*.88/inverseMass;
      if(invA) a.position.addScaledVector(delta,-correction*invA);
      if(invB) b.position.addScaledVector(delta,correction*invB);
      const relative=this._tmp.relative.copy(b.velocity).sub(a.velocity);
      const normalSpeed=relative.dot(delta);
      if(normalSpeed<0) {
        const restitution=Math.min(a.restitution,b.restitution);
        const impulse=-(1+restitution)*normalSpeed/inverseMass;
        if(invA) a.velocity.addScaledVector(delta,-impulse*invA);
        if(invB) b.velocity.addScaledVector(delta,impulse*invB);
        const impact=-normalSpeed;
        a.impact=Math.max(a.impact,impact);
        b.impact=Math.max(b.impact,impact);
      }
      a.collisions++; b.collisions++;
      a.lastCollision=b.id; b.lastCollision=a.id;
      if(penetration>.001||normalSpeed<-.02||a.held||b.held) {
        if(!a.held){a.sleeping=false;a.sleepTimer=0;}
        if(!b.held){b.sleeping=false;b.sleepTimer=0;}
      }
    }
  }

  _updateSleep(body,h) {
    const speedSq=body.velocity.lengthSq();
    const angularSq=body.angularVelocity.lengthSq();
    if(body.grounded&&speedSq<.0025&&angularSq<.8) body.sleepTimer+=h;
    else body.sleepTimer=0;
    if(body.sleepTimer>.75) {
      body.sleeping=true;
      body.velocity.set(0,0,0);
      body.angularVelocity.multiplyScalar(.1);
    }
  }

  _updatePresentation(body,dt) {
    body.room=this.environment?.roomAt?.(body.position)||body.room||'unknown';
    body.impact*=Math.exp(-12*dt);
    const squash=Math.min(.12,body.impact*.018);
    if(body.visual && body.type==='ball') {
      body.visual.scale.y=1-squash;
      body.visual.scale.x=body.visual.scale.z=1+squash*.5;
    }
    if(body.type==='mouse'&&body.tail) body.tail.rotation.y=Math.sin(this.time*5.3+body.phase)*.09*Math.min(1,body.velocity.length()*2);
    if(body.type==='feather'&&!body.rapierBody&&!body.grounded) body.mesh.rotation.z+=Math.sin(this.time*9+body.phase)*dt*.8;
    const speed=body.velocity.length();
    body.state.speed=speed;
    body.state.grounded=body.grounded;
    body.state.room=body.room;
    body.state.motion=body.held?'held':body.sleeping?'resting':body.grounded?(speed>.18?'rolling':'settling'):'airborne';
  }

  // -----------------------------------------------------------------------
  // Optional Rapier implementation. Static room geometry is represented by
  // fixed cuboids; sloped surfaces and moving doors retain the analytic solver.
  // -----------------------------------------------------------------------

  _buildRapierEnvironment() {
    if(!this._rapierWorld||!this._rapier||!this.environment) return;
    const R=this._rapier;
    for(const obstacle of this.environment.obstacles||[]) {
      if(!obstacle?.min?.isVector3||!obstacle?.max?.isVector3||obstacle.dynamic||obstacle.type==='ramp'||obstacle.enabled===false||obstacle.permeability>=1) continue;
      const size=this._tmp.axis.copy(obstacle.max).sub(obstacle.min);
      if(size.x<=0||size.y<=0||size.z<=0) continue;
      const center=this._tmp.point.copy(obstacle.min).add(obstacle.max).multiplyScalar(.5);
      const descriptor=R.ColliderDesc.cuboid(size.x/2,size.y/2,size.z/2)
        .setTranslation(center.x,center.y,center.z)
        .setRestitution(.18)
        .setFriction(.72);
      const collider=this._rapierWorld.createCollider(descriptor);
      this._rapierEnvironmentColliders.push(collider);
    }
  }

  _clearRapierEnvironment() {
    if(!this._rapierWorld) return;
    for(const collider of this._rapierEnvironmentColliders) {
      try{this._rapierWorld.removeCollider(collider,true);}catch{}
    }
    this._rapierEnvironmentColliders.length=0;
  }

  _attachRapierBody(body) {
    if(!this._rapierWorld||body.rapierBody) return;
    const R=this._rapier;
    const rigidDesc=(body.held?R.RigidBodyDesc.kinematicPositionBased():R.RigidBodyDesc.dynamic())
      .setTranslation(body.position.x,body.position.y,body.position.z)
      .setLinearDamping(body.linearDrag)
      .setAngularDamping(body.angularDrag)
      .setGravityScale(body.gravityScale)
      .setCanSleep(true)
      .setCcdEnabled(true);
    const rigid=this._rapierWorld.createRigidBody(rigidDesc);
    const density=Math.max(.01,body.mass/((4/3)*Math.PI*Math.pow(body.radius,3)));
    const colliderDesc=R.ColliderDesc.ball(body.radius)
      .setDensity(density)
      .setRestitution(body.restitution)
      .setFriction(body.friction)
      .setActiveEvents(R.ActiveEvents.COLLISION_EVENTS);
    const collider=this._rapierWorld.createCollider(colliderDesc,rigid);
    rigid.setLinvel(vectorObject(body.velocity),true);
    rigid.setAngvel(vectorObject(body.angularVelocity),true);
    body.rapierBody=rigid;
    body.rapierCollider=collider;
  }

  _updateRapier(h,steps) {
    const world=this._rapierWorld;
    for(let step=0;step<steps;step++) {
      for(const body of this.toys) {
        if(body.held) {
          body.rapierBody?.setNextKinematicTranslation(vectorObject(body.position));
          continue;
        }
        body.age+=h; body.grounded=false; body.collisions=0;
        if(body.type==='feather'&&body.rapierBody) {
          const flutter=Math.sin(this.time*11.7+body.phase+body.age*3.1);
          body.rapierBody.applyImpulse({x:Math.cos(body.phase)*flutter*.0012,y:Math.abs(flutter)*.0007,z:Math.sin(body.phase)*flutter*.0012},true);
        }
      }
      world.timestep=h;
      world.step();
      for(const body of this.toys) {
        if(body.held||!body.rapierBody) continue;
        const p=body.rapierBody.translation(), q=body.rapierBody.rotation();
        const v=body.rapierBody.linvel(),w=body.rapierBody.angvel();
        body.position.set(p.x,p.y,p.z);
        body.mesh.quaternion.set(q.x,q.y,q.z,q.w);
        body.velocity.set(v.x,v.y,v.z);
        body.angularVelocity.set(w.x,w.y,w.z);
        this._resolveWorldBounds(body,h);
        this._resolveObstacles(body,h,true);
        this._resolveGround(body,h,true);
        if(body.type==='feather'&&body.velocity.y< -2.35) body.velocity.y=-2.35;
        body.rapierBody.setTranslation(vectorObject(body.position),true);
        body.rapierBody.setLinvel(vectorObject(body.velocity),true);
        body.rapierBody.setAngvel(vectorObject(body.angularVelocity),true);
        body.sleeping=body.rapierBody.isSleeping();
      }
    }
  }

  _resolveBody(target) {
    if(!target) return this.toys[this.toys.length-1]||null;
    if(typeof target==='string') return this.toys.find(body=>body.id===target)||null;
    if(this.toys.includes(target)) return target;
    return this.toys.find(body=>body.mesh===target||body.object===target||body.mesh===target.object)||null;
  }

  getState(target) {
    if(target!==undefined) {
      const body=this._resolveBody(target);
      return body?serializeBody(body):null;
    }
    return {backend:this.backend,time:this.time,count:this.toys.length,toys:this.toys.map(serializeBody)};
  }

  getPerceptionObjects() {
    return this.toys.map(body=>({
      id:body.id,
      kind:'toy',
      type:'toy',
      toyType:body.type,
      label:body.label,
      position:body.position,
      velocity:body.velocity,
      speed:body.velocity.length(),
      sound:Math.min(1,body.impact*.22),
      visibleRange:10,
      radius:Math.max(.28,body.radius*2.5),
      physicalRadius:body.radius,
      moving:!body.sleeping&&body.velocity.lengthSq()>.0025,
      room:body.room,
      state:body.state,
      object:body.mesh,
      source:body,
      tags:['toy','prey-like',body.type],
    }));
  }

  remove(target) {
    const body=this._resolveBody(target);
    if(!body) return false;
    const index=this.toys.indexOf(body);
    if(body.rapierBody&&this._rapierWorld) this._rapierWorld.removeRigidBody(body.rapierBody);
    body.mesh.traverse(object=>{
      object.geometry?.dispose?.();
      if(Array.isArray(object.material)) object.material.forEach(mat=>mat.dispose?.());
      else object.material?.dispose?.();
    });
    body.mesh.removeFromParent();
    this.toys.splice(index,1);
    return true;
  }

  dispose() {
    if(this._disposed) return;
    for(let i=this.toys.length-1;i>=0;i--) this.remove(this.toys[i]);
    this._clearRapierEnvironment();
    this._rapierWorld?.free?.();
    this._rapierWorld=null; this._rapier=null;
    this.root.removeFromParent();
    this._disposed=true;
  }
}

function standardMaterial(color,roughness=.8,metalness=0,extra={}) {
  return new THREE.MeshStandardMaterial({color,roughness,metalness,...extra});
}

function normalizeCreateArguments(position,options,fallback) {
  if(position && !position.isVector3 && !Array.isArray(position) && typeof position==='object') {
    options=position;
    position=options.position||fallback;
  }
  return {position:toVector(position||fallback),options:options||{}};
}

function toVector(value) {
  if(value?.isVector3) return new THREE.Vector3(finiteNumber(value.x,0),finiteNumber(value.y,0),finiteNumber(value.z,0));
  if(Array.isArray(value)) return new THREE.Vector3(finiteNumber(value[0],0),finiteNumber(value[1],0),finiteNumber(value[2],0));
  if(value&&typeof value==='object') return new THREE.Vector3(finiteNumber(value.x,0),finiteNumber(value.y,0),finiteNumber(value.z,0));
  return new THREE.Vector3();
}

function vectorObject(vector) { return {x:vector.x,y:vector.y,z:vector.z}; }
function clamp(value,min,max){return Math.max(min,Math.min(max,value));}
function finiteNumber(value,fallback){return Number.isFinite(value)?value:fallback;}
function positiveFinite(value,fallback){return Math.max(1e-5,finiteNumber(value,fallback));}

function serializeBody(body) {
  return {
    id:body.id,
    type:body.type,
    label:body.label,
    position:{x:body.position.x,y:body.position.y,z:body.position.z},
    velocity:{x:body.velocity.x,y:body.velocity.y,z:body.velocity.z},
    angularVelocity:{x:body.angularVelocity.x,y:body.angularVelocity.y,z:body.angularVelocity.z},
    radius:body.radius,
    mass:body.mass,
    sleeping:body.sleeping,
    held:body.held,
    grounded:body.grounded,
    room:body.room,
    motion:body.state.motion,
    lastCollision:body.lastCollision,
  };
}

export default ToyPhysics;
