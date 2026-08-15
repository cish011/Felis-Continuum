import * as THREE from 'three';
import furVertexShader from '../shaders/fur.vert.glsl?raw';
import furFragmentShader from '../shaders/fur.frag.glsl?raw';
import { COATS, EYE_COLORS } from '../data/catalog.js';
import { clamp, damp, dampAngle, lerp, smoothstep, TAU } from '../core/math.js';
import {
  createAnatomicalLoft,
  createEyelidGeometry,
  createInnerPinnaGeometry,
  createJawGeometry,
  createNasalBridgeGeometry,
  createNeckGeometry,
  createNoseGeometry,
  createOrbitalMaskGeometry,
  createPawGeometry,
  createPinnaGeometry,
  createSkullGeometry,
  createTaperedLimbGeometry,
  createTorsoGeometry,
} from './cat-anatomy.js';

const FORWARD = new THREE.Vector3(0, 0, 1);
const UP = new THREE.Vector3(0, 1, 0);
const SHELL_LAYERS = 8;
const ANATOMY_DIAGNOSTIC = true;
const REGION = Object.freeze({ torso:0, face:1, limb:2, tail:3, ear:4, muzzle:5 });
const PATTERN = Object.freeze({ solid:0, tabby:1, classic:2, tuxedo:3, calico:4, tortie:5, point:6 });
const LIMB_KEYS = ['frontLeft','frontRight','hindLeft','hindRight'];

function v3(value, fallback = new THREE.Vector3()) {
  if (value?.isVector3) return value.clone();
  if (value && Number.isFinite(value.x) && Number.isFinite(value.z)) return new THREE.Vector3(value.x, value.y ?? 0, value.z);
  if (Array.isArray(value)) return new THREE.Vector3(value[0]??0,value[1]??0,value[2]??0);
  return fallback.clone();
}

function color(value, fallback=0x888888) {
  try { return new THREE.Color(value ?? fallback); } catch { return new THREE.Color(fallback); }
}

function disposeMaterial(material) {
  if (Array.isArray(material)) material.forEach(disposeMaterial);
  else material?.dispose?.();
}

function seeded(index) {
  const x = Math.sin(index * 91.733 + 17.17) * 43758.5453;
  return x - Math.floor(x);
}

function addFurAttributes(geometry, region, seed) {
  const count = geometry.attributes.position.count;
  const regions = new Float32Array(count);
  const seeds = new Float32Array(count);
  for (let i=0;i<count;i++) {
    regions[i] = region;
    seeds[i] = (seeded(i + seed*131) + seed) % 1;
  }
  geometry.setAttribute('aCatRegion', new THREE.BufferAttribute(regions,1));
  geometry.setAttribute('aFurSeed', new THREE.BufferAttribute(seeds,1));
  return geometry;
}

function ellipsoidGeometry(detail=28) {
  return new THREE.SphereGeometry(1,detail,Math.max(12,Math.floor(detail*.66)));
}

function earGeometry() {
  const positions = new Float32Array([
    -.075,0,-.025,  .075,0,-.025,  0,.17,-.012,
    -.075,0,-.025,  0,.17,-.012,   0,.018,.055,
     .075,0,-.025,  0,.018,.055,   0,.17,-.012,
    -.075,0,-.025,  0,.018,.055,   .075,0,-.025,
  ]);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));
  geometry.computeVertexNormals();
  geometry.setAttribute('uv',new THREE.BufferAttribute(new Float32Array(positions.length/3*2),2));
  return geometry;
}

/**
 * Procedural adult domestic-cat renderer. The motion controller supplies only
 * physical root/paw targets; this class owns anatomy, IK pose presentation,
 * fur, gaze and additive micro-movement, never goal selection.
 */
export class CatModel {
  constructor(profile={}) {
    this.profile = { ...profile };
    this.root = new THREE.Group();
    this.root.name = 'Procedural domestic cat';
    this.root.matrixAutoUpdate = true;
    this.body = new THREE.Group();
    this.body.name = 'thoracolumbar-body';
    // Anatomy source coordinates are metres at adult domestic-shorthair scale.
    this.anatomicalScale = 1;
    this.root.add(this.body);
    this.anatomy = {};
    this.limbs = {};
    this.tail = [];
    this.pettable = [];
    this.partRecords = [];
    this.geometries = new Set();
    this.materials = new Set();
    this.shellMaterials = [];
    this.eyeMaterials = [];
    this.anatomyDiagnostic = ANATOMY_DIAGNOSTIC;
    this.debug = new THREE.Group();
    this.debug.name = 'Cat IK diagnostics';
    this.debug.visible = false;
    this.root.add(this.debug);
    this.tmp = {
      a:new THREE.Vector3(), b:new THREE.Vector3(), c:new THREE.Vector3(), d:new THREE.Vector3(),
      e:new THREE.Vector3(), q:new THREE.Quaternion(), matrix:new THREE.Matrix4(),
      inverse:new THREE.Matrix4(), basis:new THREE.Matrix4(), normalMatrix:new THREE.Matrix3(),
    };
    this.state = {
      headYaw:0, headPitch:0, eyeYaw:0, eyePitch:0,
      leftEarYaw:0, rightEarYaw:0, earFlatten:0,
      blink:0, blinkPhase:-1, nextBlink:1.7,
      pupil:.38, breath:0, petLean:0, whiskerProtract:.1,
      tailSway:0, tailLift:.12,
      spineBend:0, spineFlex:0,
    };
    this.catWorld = new THREE.Matrix4();
    this.catWorldInverse = new THREE.Matrix4();
    this.buildMaterials();
    this.buildBody();
    this.buildHead();
    this.buildLimbs();
    this.buildTail();
    this.buildGuardHairs();
    this.buildDebugRig();
    this.applyProfile(profile);
  }

  buildMaterials() {
    this.sharedUniforms = {
      uTime:{value:0},
      uFurLength:{value:.014},
      uFurDensity:{value:.9},
      uMotionEnergy:{value:0},
      uPattern:{value:1},
      uBaseColor:{value:new THREE.Color(0x999b97)},
      uDarkColor:{value:new THREE.Color(0x242826)},
      uWarmColor:{value:new THREE.Color(0xc3b9a3)},
      uCatWorldMatrix:{value:this.catWorld},
      uCatWorldInverse:{value:this.catWorldInverse},
    };
    for (let layer=0;layer<=SHELL_LAYERS;layer++) {
      const amount = layer/SHELL_LAYERS;
      const uniforms = { ...this.sharedUniforms, uLayer:{value:amount} };
      const material = new THREE.ShaderMaterial({
        name:`biological-fur-shell-${layer}`,
        vertexShader:furVertexShader,
        fragmentShader:furFragmentShader,
        uniforms,
        transparent:layer>0,
        depthWrite:layer===0,
        depthTest:true,
        side:THREE.FrontSide,
        alphaToCoverage:layer>0,
        toneMapped:true,
      });
      material.extensions.derivatives = true;
      this.shellMaterials.push(material);
      this.materials.add(material);
    }
    this.diagnosticMaterial = new THREE.MeshStandardMaterial({
      name:'neutral-anatomy-validation-surface',
      color:0x9da29e,
      roughness:.78,
      metalness:0,
    });
    this.padMaterial = new THREE.MeshStandardMaterial({color:0x5b4648,roughness:.82,metalness:0});
    this.noseMaterial = new THREE.MeshPhysicalMaterial({color:0x6d4f51,roughness:.48,clearcoat:.16,clearcoatRoughness:.6});
    this.innerEarMaterial = new THREE.MeshStandardMaterial({color:0xa87978,roughness:.91,side:THREE.DoubleSide});
    this.clawMaterial = new THREE.MeshPhysicalMaterial({color:0xe8dfcf,roughness:.3,transmission:.08,thickness:.01});
    this.whiskerMaterial = new THREE.LineBasicMaterial({color:0xe9e2d5,transparent:true,opacity:.38});
    this.collarMaterial = new THREE.MeshPhysicalMaterial({color:0x4d796e,roughness:.42,metalness:.08,clearcoat:.18});
    this.metalMaterial = new THREE.MeshStandardMaterial({color:0xb9aa72,roughness:.3,metalness:.78});
    for (const material of [this.diagnosticMaterial,this.padMaterial,this.noseMaterial,this.innerEarMaterial,this.clawMaterial,this.whiskerMaterial,this.collarMaterial,this.metalMaterial]) this.materials.add(material);
  }

  createFurredPart({name,parent=this.body,geometry=ellipsoidGeometry(),position=[0,0,0],scale=[1,1,1],region=REGION.torso,petPart=name,shells=SHELL_LAYERS,seed=1}) {
    const group = new THREE.Group();
    group.name = name;
    group.position.set(...position);
    group.scale.set(...scale);
    parent.add(group);
    const furGeometry = addFurAttributes(geometry,region,seed);
    this.geometries.add(furGeometry);
    const base = new THREE.Mesh(furGeometry,this.anatomyDiagnostic ? this.diagnosticMaterial : this.shellMaterials[0]);
    base.name = `${name}-skin-and-undercoat`;
    base.castShadow=true; base.receiveShadow=true;
    base.userData.catPart=petPart;
    group.add(base);
    this.pettable.push(base);
    const shellMeshes=[];
    for(let layer=1;layer<=Math.min(SHELL_LAYERS,shells);layer++) {
      const shell=new THREE.Mesh(furGeometry,this.shellMaterials[layer]);
      shell.name=`${name}-fur-${layer}`;
      shell.renderOrder=layer;
      shell.frustumCulled=true;
      shell.visible=!this.anatomyDiagnostic;
      group.add(shell);
      shellMeshes.push(shell);
    }
    const record={
      name,group,base,shellMeshes,geometry:furGeometry,region,petPart,
      bindPosition:group.position.clone(),bindScale:group.scale.clone(),bindQuaternion:group.quaternion.clone(),
    };
    this.partRecords.push(record);
    return record;
  }

  buildBody() {
    // One continuous thoraco-lumbar skin carries the actual silhouette. Its
    // cross-sections encode the pelvic bowl, lumbar waist, deep ribcage and
    // narrowed thoracic inlet instead of stacking inflated spheres.
    this.anatomy.torso=this.createFurredPart({
      name:'continuous-pelvis-waist-ribcage',geometry:createTorsoGeometry(),
      position:[0,0,0],region:REGION.torso,petPart:'torso',shells:8,seed:2,
    });
    this.anatomy.tailRoot=this.createFurredPart({
      name:'blended-caudal-tail-root',
      geometry:createAnatomicalLoft([
        {z:-.030,rx:.011,ry:.012,y:.001},
        {z:-.012,rx:.015,ry:.016,y:.002},
        {z:.010,rx:.018,ry:.018,y:.003},
        {z:.027,rx:.011,ry:.012,y:.002},
      ],24),
      position:[0,.020,-.194],petPart:'rump',shells:2,seed:3,
    });
    this.anatomy.sternum=this.createFurredPart({
      name:'sternum-and-pectoral-keel',position:[0,-.055,.108],scale:[.038,.026,.061],
      petPart:'chest',shells:3,seed:4,
    });
    this.anatomy.sternum.group.visible=false;
    this.anatomy.neck=this.createFurredPart({
      name:'tapered-cervical-transition',geometry:createNeckGeometry(),position:[0,.030,.170],
      petPart:'neck',shells:5,seed:5,
    });
    this.anatomy.neck.group.rotation.x=-.20;

    // Scapulae remain mobile, but are narrow subcutaneous ridges rather than
    // shoulder balloons. Left is -X under the locomotion coordinate contract.
    this.anatomy.scapulaLeft=this.createFurredPart({name:'left-mobile-scapula',position:[-.056,.037,.112],scale:[.010,.029,.050],petPart:'back',shells:2,seed:20});
    this.anatomy.scapulaRight=this.createFurredPart({name:'right-mobile-scapula',position:[.056,.037,.112],scale:[.010,.029,.050],petPart:'back',shells:2,seed:21});
    this.anatomy.scapulaLeft.group.rotation.x=-.17;
    this.anatomy.scapulaRight.group.rotation.x=-.17;
    this.anatomy.scapulaLeft.group.visible=false;
    this.anatomy.scapulaRight.group.visible=false;

    // Small dorsal landmarks provide moving skin cues without changing the
    // smooth diagnostic outline into a row of beads.
    this.anatomy.spine=[];
    for(let i=0;i<4;i++) {
      const z=-.085+i*.061;
      const segment=this.createFurredPart({name:`subtle-dorsal-landmark-${i}`,position:[0,.057,z],scale:[.025,.006,.034],petPart:'back',shells:1,seed:10+i});
      segment.group.visible=false;
      this.anatomy.spine.push(segment);
    }

    this.collar=new THREE.Group(); this.collar.name='collar'; this.collar.position.set(0,.038,.184); this.body.add(this.collar);
    const band=new THREE.Mesh(new THREE.TorusGeometry(.043,.0055,7,40),this.collarMaterial);
    band.rotation.x=-.20; band.scale.y=1.08; band.castShadow=true; this.collar.add(band);
    const tag=new THREE.Mesh(new THREE.CylinderGeometry(.025,.025,.008,18),this.metalMaterial);
    tag.rotation.x=Math.PI/2; tag.position.set(0,-.047,.012); tag.scale.setScalar(.48); tag.castShadow=true; this.collar.add(tag);
  }

  buildHead() {
    this.headRig=new THREE.Group();
    this.headRig.name='atlanto-occipital-head-rig';
    this.headRig.position.set(0,.078,.170);
    this.body.add(this.headRig);
    this.anatomy.skull=this.createFurredPart({
      name:'tapered-mesocephalic-cranium',parent:this.headRig,geometry:createSkullGeometry(),
      region:REGION.face,petPart:'head',shells:5,seed:30,
    });
    this.anatomy.zygomaticLeft=this.createFurredPart({name:'left-zygomatic-cheek',parent:this.headRig,position:[-.034,-.005,.044],scale:[.008,.011,.013],region:REGION.face,petPart:'cheek',shells:1,seed:31});
    this.anatomy.zygomaticRight=this.createFurredPart({name:'right-zygomatic-cheek',parent:this.headRig,position:[.034,-.005,.044],scale:[.008,.011,.013],region:REGION.face,petPart:'cheek',shells:1,seed:32});
    this.anatomy.nasalBridge=this.createFurredPart({name:'nasal-bridge',parent:this.headRig,geometry:createNasalBridgeGeometry(),position:[0,.004,.046],region:REGION.muzzle,petPart:'muzzle',shells:2,seed:33});
    this.anatomy.cheekLeft=this.createFurredPart({name:'left-whisker-pad',parent:this.headRig,position:[-.013,-.020,.087],scale:[.012,.007,.013],region:REGION.muzzle,petPart:'cheek',shells:1,seed:34});
    this.anatomy.cheekRight=this.createFurredPart({name:'right-whisker-pad',parent:this.headRig,position:[.013,-.020,.087],scale:[.012,.007,.013],region:REGION.muzzle,petPart:'cheek',shells:1,seed:35});
    this.anatomy.jaw=this.createFurredPart({name:'mandible-and-chin',parent:this.headRig,geometry:createJawGeometry(),position:[0,-.029,.051],scale:[.80,.82,.72],region:REGION.muzzle,petPart:'muzzle',shells:2,seed:36});
    this.anatomy.browLeft=this.createFurredPart({name:'left-brow-orbital-ridge',parent:this.headRig,position:[-.027,.024,.048],scale:[.011,.002,.008],region:REGION.face,petPart:'head',shells:1,seed:37});
    this.anatomy.browRight=this.createFurredPart({name:'right-brow-orbital-ridge',parent:this.headRig,position:[.027,.024,.048],scale:[.011,.002,.008],region:REGION.face,petPart:'head',shells:1,seed:38});
    // The continuous head envelope carries these planes. Exposing helper
    // ellipsoids turns a measured skull back into a stack of balls.
    this.anatomy.zygomaticLeft.group.visible=false;
    this.anatomy.zygomaticRight.group.visible=false;
    this.anatomy.nasalBridge.group.visible=false;
    this.anatomy.browLeft.group.visible=false;
    this.anatomy.browRight.group.visible=false;

    const nose=new THREE.Mesh(createNoseGeometry(),this.noseMaterial);
    this.geometries.add(nose.geometry);
    nose.name='triangular-nasal-leather'; nose.position.set(0,-.019,.072); nose.castShadow=true;
    nose.userData.catPart='muzzle'; this.headRig.add(nose); this.pettable.push(nose); this.anatomy.nose=nose;
    const philtrum=new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0,-.025,.077),new THREE.Vector3(0,-.036,.064)]),
      new THREE.LineBasicMaterial({color:0x503f40,transparent:true,opacity:.55})
    );
    this.materials.add(philtrum.material); this.geometries.add(philtrum.geometry); this.headRig.add(philtrum);

    this.eyes={};
    for(const [side,sign] of [['left',-1],['right',1]]) this.eyes[side]=this.createEye(side,sign);
    this.ears={};
    for(const [side,sign] of [['left',-1],['right',1]]) this.ears[side]=this.createEar(side,sign);
    this.whiskers={left:this.createWhiskers(-1),right:this.createWhiskers(1)};
  }

  createEye(side,sign) {
    const rig=new THREE.Group(); rig.name=`${side}-eye-rig`; rig.position.set(sign*.028,.009,.042); this.headRig.add(rig);
    // Almost no white sclera is exposed in a relaxed cat. The globe is buried
    // behind an almond aperture; only the iris/cornea project slightly.
    const scleraMat=new THREE.MeshPhysicalMaterial({color:0x252a22,roughness:.26,clearcoat:.55,clearcoatRoughness:.14});
    const irisMat=new THREE.MeshPhysicalMaterial({color:0x9ab56a,roughness:.34,metalness:.03,clearcoat:.65,clearcoatRoughness:.12});
    const pupilMat=new THREE.MeshBasicMaterial({color:0x040504});
    const corneaMat=new THREE.MeshPhysicalMaterial({color:0xdceff0,transparent:true,opacity:.17,roughness:.02,transmission:.4,thickness:.012,clearcoat:1});
    for(const material of [scleraMat,irisMat,pupilMat,corneaMat]) {this.materials.add(material);this.eyeMaterials.push(material);}
    const globeRig=new THREE.Group(); globeRig.name=`${side}-mobile-globe`; rig.add(globeRig);
    const globe=new THREE.Mesh(new THREE.SphereGeometry(.0102,28,20),scleraMat); globe.scale.set(1,.98,1.03); globe.castShadow=true; globeRig.add(globe);
    const iris=new THREE.Mesh(new THREE.CircleGeometry(.00755,32),irisMat); iris.scale.set(1,.96,1); iris.position.z=.01015; globeRig.add(iris);
    const pupil=new THREE.Mesh(new THREE.CircleGeometry(.0065,28),pupilMat); pupil.scale.set(.18,.96,1); pupil.position.z=.01045; globeRig.add(pupil);
    const catchlight=new THREE.Mesh(new THREE.CircleGeometry(.00135,12),new THREE.MeshBasicMaterial({color:0xf8fff5,transparent:true,opacity:.78}));
    this.materials.add(catchlight.material); catchlight.position.set(-sign*.0021,.0022,.0107); globeRig.add(catchlight);
    const cornea=new THREE.Mesh(new THREE.SphereGeometry(.0103,28,14,0,TAU,0,Math.PI*.51),corneaMat); cornea.rotation.x=Math.PI/2; cornea.position.z=.0015; cornea.scale.set(1,.98,1.03); cornea.visible=true; globeRig.add(cornea);
    const socket=this.createFurredPart({name:`${side}-orbital-skin`,parent:rig,geometry:createOrbitalMaskGeometry(),position:[0,0,.01065],region:REGION.face,petPart:'head',shells:0,seed:39+(sign>0?1:2)});
    const upper=this.createFurredPart({name:`${side}-upper-eyelid`,parent:rig,geometry:createEyelidGeometry(.00825,.00575,true),position:[0,0,.0109],region:REGION.muzzle,petPart:'head',shells:0,seed:40+(sign>0?1:2)});
    const lower=this.createFurredPart({name:`${side}-lower-eyelid`,parent:rig,geometry:createEyelidGeometry(.00825,.00575,false),position:[0,0,.0109],region:REGION.muzzle,petPart:'head',shells:0,seed:43+(sign>0?1:2)});
    return {rig,globeRig,globe,iris,pupil,cornea,socket,upperLid:upper.group,lowerLid:lower.group,sign};
  }

  createEar(side,sign) {
    const rig=new THREE.Group(); rig.name=`${side}-pinna-rig`; rig.position.set(sign*.031,.029,.007); this.headRig.add(rig);
    rig.scale.x=sign;
    const outer=this.createFurredPart({name:`${side}-cartilaginous-pinna`,parent:rig,geometry:createPinnaGeometry(),position:[0,0,0],region:REGION.ear,petPart:'ear',shells:2,seed:50+(sign>0?1:2)});
    const innerGeometry=createInnerPinnaGeometry(); this.geometries.add(innerGeometry);
    const inner=new THREE.Mesh(innerGeometry,this.innerEarMaterial); inner.position.set(0,0,.0045); inner.scale.set(.88,.91,1); inner.userData.catPart='ear'; rig.add(inner); this.pettable.push(inner);
    rig.rotation.z=-sign*.30;
    rig.rotation.x=-.10;
    return {rig,outer,inner,sign};
  }

  createWhiskers(sign) {
    const group=new THREE.Group(); group.name=sign<0?'left-vibrissae':'right-vibrissae'; this.headRig.add(group);
    const lines=[];
    for(let row=0;row<4;row++) for(let column=0;column<3;column++) {
      const root=new THREE.Vector3(sign*(.032+column*.002),-.018-row*.006,.068-row*.002);
      const length=.061+row*.006+column*.004;
      const end=new THREE.Vector3(sign*(.035+length),-.012-row*.007,.058-row*.007);
      const control=root.clone().lerp(end,.5).add(new THREE.Vector3(sign*.007,.007-column*.002,.008));
      const curve=new THREE.QuadraticBezierCurve3(root,control,end);
      const geometry=new THREE.BufferGeometry().setFromPoints(curve.getPoints(14));
      this.geometries.add(geometry);
      const line=new THREE.Line(geometry,this.whiskerMaterial); line.userData.basePoints={root,control,end,row,column}; group.add(line); lines.push(line);
    }
    // Supraorbital whiskers are shorter and curve upward.
    for(let i=0;i<2;i++) {
      const root=new THREE.Vector3(sign*(.026+i*.006),.030,.057);
      const curve=new THREE.QuadraticBezierCurve3(root,root.clone().add(new THREE.Vector3(sign*.012,.021,.005)),root.clone().add(new THREE.Vector3(sign*.022,.041,-.002)));
      const geometry=new THREE.BufferGeometry().setFromPoints(curve.getPoints(10)); this.geometries.add(geometry);
      const line=new THREE.Line(geometry,this.whiskerMaterial); group.add(line); lines.push(line);
    }
    return {group,lines,sign};
  }

  buildLimbs() {
    const specs={
      frontLeft:{side:-1,front:true,anchor:[-.053,-.004,.143],pole:[-.10,-.05,-1],upper:.0919,lower:.0920,distal:.0329},
      frontRight:{side:1,front:true,anchor:[.053,-.004,.143],pole:[.10,-.05,-1],upper:.0919,lower:.0920,distal:.0329},
      hindLeft:{side:-1,front:false,anchor:[-.041,.006,-.145],pole:[-.08,.02,1],upper:.1031,lower:.1142,distal:.0544},
      hindRight:{side:1,front:false,anchor:[.041,.006,-.145],pole:[.08,.02,1],upper:.1031,lower:.1142,distal:.0544},
    };
    let seed=70;
    for(const [key,spec] of Object.entries(specs)) {
      const upper=this.createSegment(`${key}-${spec.front?'brachium':'thigh'}`,spec.front?[.019,.012]:[.031,.015],spec.upper,spec.front?'frontLeg':'hindLeg',seed++,{depth:.84,bulge:spec.front ? .12 : .2});
      const lower=this.createSegment(`${key}-${spec.front?'forearm':'crus'}`,spec.front?[.014,.008]:[.018,.009],spec.lower,spec.front?'frontLeg':'hindLeg',seed++,{depth:.88,bulge:.11});
      const metapodial=this.createSegment(`${key}-${spec.front?'carpus':'metatarsus'}`,spec.front?[.008,.006]:[.009,.006],spec.distal,spec.front?'frontLeg':'hindLeg',seed++,{depth:.82,bulge:.04});
      const paw=this.createPaw(key,spec,seed++);
      const scapula=spec.front?(spec.side<0?this.anatomy.scapulaLeft:this.anatomy.scapulaRight):null;
      const jointMass=this.createFurredPart({name:`${key}-${spec.front?'elbow':'stifle'}-joint`,parent:this.root,scale:spec.front?[.010,.009,.011]:[.014,.012,.015],region:REGION.limb,petPart:spec.front?'frontLeg':'hindLeg',shells:1,seed:seed++});
      const distalMass=this.createFurredPart({name:`${key}-${spec.front?'carpus':'hock'}-joint`,parent:this.root,scale:spec.front?[.0065,.006,.0075]:[.0085,.0075,.009],region:REGION.limb,petPart:spec.front?'frontLeg':'hindLeg',shells:1,seed:seed++});
      jointMass.group.visible=false;
      distalMass.group.visible=false;
      this.limbs[key]={...spec,key,anchor:new THREE.Vector3(...spec.anchor),pole:new THREE.Vector3(...spec.pole),upper,lower,metapodial,paw,scapula,
        jointMass,distalMass,shoulder:new THREE.Vector3(),joint:new THREE.Vector3(),wrist:new THREE.Vector3(),foot:new THREE.Vector3(),normal:new THREE.Vector3(0,1,0)};
    }
  }

  createSegment(name,radius,length,petPart,seed,shape={}) {
    const radii=Array.isArray(radius)?radius:[radius,radius*.82];
    // Overlap adjacent muscle envelopes while retaining the measured
    // kinematic length. This removes the need for axis-aligned joint balls.
    const geometry=createTaperedLimbGeometry(length*1.12,radii[0],radii[1],shape);
    const part=this.createFurredPart({name,parent:this.root,geometry,region:REGION.limb,petPart,shells:3,seed});
    part.baseLength=length;
    return part;
  }

  createPaw(key,spec,seed) {
    const group=new THREE.Group(); group.name=`${key}-paw-rig`; this.root.add(group);
    group.scale.set(1,1,1);
    const paw=this.createFurredPart({name:`${key}-pear-shaped-paw`,parent:group,geometry:createPawGeometry(),region:REGION.limb,petPart:'paw',shells:2,seed});
    const pads=new THREE.Group(); pads.name=`${key}-pads`; group.add(pads);
    const central=new THREE.Mesh(new THREE.SphereGeometry(1,14,8),this.padMaterial);
    central.scale.set(spec.front ? .0101 : .0075,.0038,spec.front ? .0070 : .0065); central.position.set(0,-.0102,-.002); central.userData.catPart='paw'; pads.add(central); this.pettable.push(central);
    for(let digit=0;digit<4;digit++) {
      const toe=this.createFurredPart({name:`${key}-digit-${digit}`,parent:group,position:[(digit-1.5)*.0055,-.001,.021+Math.abs(digit-1.5)*.0005],scale:[.0044,.0042,.0075],region:REGION.limb,petPart:'paw',shells:1,seed:seed+digit+1});
      toe.group.rotation.y=(digit-1.5)*-.035;
      const digital=new THREE.Mesh(new THREE.SphereGeometry(1,12,7),this.padMaterial);
      digital.scale.set(spec.front ? .00275 : .00315,.0022,spec.front ? .0050 : .0060);
      digital.position.set((digit-1.5)*.0055,-.0104,.021+Math.abs(digit-1.5)*.0005);
      digital.userData.catPart='paw'; pads.add(digital); this.pettable.push(digital);
      const claw=new THREE.Mesh(new THREE.ConeGeometry(.006,.025,7),this.clawMaterial);
      claw.name=`${key}-claw-${digit}`; claw.scale.setScalar(.42); claw.rotation.x=Math.PI/2; claw.position.set((digit-1.5)*.0055,-.001,.029); claw.visible=false; pads.add(claw);
    }
    if(spec.front) {
      const carpal=new THREE.Mesh(new THREE.SphereGeometry(1,11,7),this.padMaterial);
      carpal.scale.set(.0055,.0025,.007); carpal.position.set(-spec.side*.011,-.006,-.022); carpal.userData.catPart='paw'; pads.add(carpal); this.pettable.push(carpal);
      const dewclaw=new THREE.Mesh(new THREE.ConeGeometry(.005,.021,7),this.clawMaterial);
      dewclaw.scale.setScalar(.42); dewclaw.rotation.z=-spec.side*.75; dewclaw.position.set(-spec.side*.016,.008,-.013); pads.add(dewclaw);
    }
    return {group,paw,pads,contactOffset:spec.front?.0085:.0080,claws:pads.children.filter(child=>child.material===this.clawMaterial)};
  }

  buildTail() {
    for(let i=0;i<14;i++) {
      const length=.023-i*.00028, radius=.0105*(1-i/15)+.0015;
      const nextRadius=.0105*(1-(i+1)/15)+.0015;
      const geometry=createTaperedLimbGeometry(length*1.17,radius,nextRadius,{depth:1,bulge:-.04,segments:5,radial:14});
      const segment=this.createFurredPart({name:`tail-segment-${i}`,parent:this.root,geometry,region:REGION.tail,petPart:'tail',shells:2,seed:110+i});
      // Geometry overlaps adjacent joints by 17%; baseLength remains the
      // kinematic length so the centreline retains the measured 29.5 cm tail.
      segment.baseLength=length;
      this.tail.push({part:segment,length,radius,start:new THREE.Vector3(),end:new THREE.Vector3()});
    }
  }

  buildGuardHairs() {
    const geometry=new THREE.ConeGeometry(.7,5,3,1); geometry.translate(0,2.5,0); this.geometries.add(geometry);
    this.guardMaterial=new THREE.MeshStandardMaterial({color:0xa8aaa4,roughness:.96,transparent:true,opacity:.52,side:THREE.DoubleSide});
    this.materials.add(this.guardMaterial);
    const count=460;
    const guards=new THREE.InstancedMesh(geometry,this.guardMaterial,count);
    guards.name='sparse-silhouette-guard-hairs'; guards.frustumCulled=true; guards.castShadow=false;
    guards.visible=!this.anatomyDiagnostic;
    const matrix=new THREE.Matrix4(), quaternion=new THREE.Quaternion(), position=new THREE.Vector3(), normal=new THREE.Vector3(), scale=new THREE.Vector3();
    for(let i=0;i<count;i++) {
      const u=seeded(i*3+1)*2-1, angle=seeded(i*3+2)*TAU;
      const r=Math.sqrt(Math.max(0,1-u*u));
      normal.set(Math.cos(angle)*r,u,Math.sin(angle)*r).normalize();
      const centerZ=lerp(-.25,.30,seeded(i*7+4));
      const radiusX=.155*(1-Math.abs(centerZ)*.65), radiusY=.165*(1-Math.abs(centerZ)*.42);
      position.set(normal.x*radiusX,normal.y*radiusY+.015,centerZ+normal.z*.11);
      quaternion.setFromUnitVectors(UP,normal);
      const strandLength=lerp(.010,.025,seeded(i*11+5));
      scale.set(.0018,.0018*strandLength/.009,.0018);
      matrix.compose(position,quaternion,scale); guards.setMatrixAt(i,matrix);
    }
    guards.instanceMatrix.needsUpdate=true; this.body.add(guards); this.guardHairs=guards;
  }

  buildDebugRig() {
    const material=new THREE.MeshBasicMaterial({color:0x77e5ff,depthTest:false,transparent:true,opacity:.75}); this.materials.add(material);
    this.debugJoints={};
    for(const key of LIMB_KEYS) {
      this.debugJoints[key]=[];
      for(let i=0;i<4;i++) {
        const marker=new THREE.Mesh(new THREE.SphereGeometry(.015,8,6),material); marker.renderOrder=200; this.debug.add(marker); this.debugJoints[key].push(marker);
      }
    }
  }

  applyProfile(profile={}) {
    this.profile={...this.profile,...profile};
    const coat=COATS[this.profile.coat] ?? COATS.silverTabby;
    const eyes=EYE_COLORS[this.profile.eyeColor] ?? EYE_COLORS.lichen;
    if(this.anatomyDiagnostic) {
      this.sharedUniforms.uBaseColor.value.set(0x777b78);
      this.sharedUniforms.uDarkColor.value.set(0x656966);
      this.sharedUniforms.uWarmColor.value.set(0x858985);
      this.sharedUniforms.uPattern.value=0;
    } else {
      this.sharedUniforms.uBaseColor.value.copy(color(coat.base));
      this.sharedUniforms.uDarkColor.value.copy(color(coat.dark));
      this.sharedUniforms.uWarmColor.value.copy(color(coat.warm));
      this.sharedUniforms.uPattern.value=PATTERN[coat.pattern] ?? 0;
    }
    const furAmount=clamp(Number(this.profile.furLength ?? .42));
    this.sharedUniforms.uFurLength.value=lerp(.0065,.027,furAmount);
    this.sharedUniforms.uFurDensity.value=lerp(.78,1.08,furAmount);
    this.root.scale.setScalar(clamp(Number(this.profile.bodySize ?? 1),.82,1.18));
    this.collar.visible=!this.anatomyDiagnostic&&this.profile.collar!==false;
    this.guardMaterial.color.copy(color(coat.warm)).lerp(color(coat.base),.6);
    this.guardMaterial.opacity=lerp(.30,.68,furAmount);
    for(const eye of Object.values(this.eyes)) {
      eye.iris.material.color.copy(color(eyes.iris));
      eye.iris.material.emissive?.copy?.(color(eyes.rim));
      if(eye.iris.material.emissiveIntensity!==undefined) eye.iris.material.emissiveIntensity=.055;
    }
  }

  setAnatomyDiagnostic(enabled=true) {
    this.anatomyDiagnostic=Boolean(enabled);
    for(const part of this.partRecords) {
      part.base.material=this.anatomyDiagnostic?this.diagnosticMaterial:this.shellMaterials[0];
      for(const shell of part.shellMeshes) shell.visible=!this.anatomyDiagnostic;
    }
    if(this.guardHairs) this.guardHairs.visible=!this.anatomyDiagnostic;
    if(this.collar) this.collar.visible=!this.anatomyDiagnostic&&this.profile.collar!==false;
    this.applyProfile(this.profile);
    this.continuousSkin?.setLegacySkinHidden(true,this);
  }

  setDiagnosticMode(options=true) {
    const enabled=typeof options==='object'
      ? options.anatomy !== false || options.fur === false
      : Boolean(options);
    this.setAnatomyDiagnostic(enabled);
  }

  update(motion={},cognition={},dt=1/60,time=0) {
    dt=clamp(Number(dt)||0,0,.1);
    // The continuous neutral skin consumes the exact locomotion state after
    // this presentation rig has updated.  Keeping the reference here avoids
    // independently reconstructing spine flex and support-height offsets.
    this.lastMotion=motion;
    const scale=Math.max(.001,this.root.scale.x||1);
    const position=v3(motion.position,this.root.position);
    this.root.position.copy(position);
    this.root.rotation.y=dampAngle(this.root.rotation.y,Number(motion.heading)||0,20,dt);
    const bodyHeight=(Number(motion.bodyHeight)>.10?Number(motion.bodyHeight):.19*scale)/scale;
    this.body.position.y=damp(this.body.position.y,bodyHeight,18,dt);
    this.body.rotation.x=damp(this.body.rotation.x,Number(motion.bodyPitch)||0,12,dt);
    this.body.rotation.z=damp(this.body.rotation.z,-(Number(motion.bank)||0),12,dt);
    this.body.updateMatrixWorld(true);
    this.root.updateMatrixWorld(true);
    this.catWorld.copy(this.root.matrixWorld);
    this.catWorldInverse.copy(this.root.matrixWorld).invert();
    this.sharedUniforms.uTime.value=time;
    this.sharedUniforms.uMotionEnergy.value=clamp((Number(motion.speed)||0)/4.2);

    this.updateSpine(motion,dt,time);
    this.updateAttention(motion,cognition,dt,time);
    this.updateFace(motion,cognition,dt,time);
    this.updateMicroMotion(motion,cognition,dt,time);
    this.updateLimbs(motion,dt,time);
    this.updateTail(motion,cognition,dt,time);
    this.updateDebug();
    this.root.updateMatrixWorld(true);
    this.catWorld.copy(this.root.matrixWorld);
    this.catWorldInverse.copy(this.root.matrixWorld).invert();
  }

  updateSpine(motion,dt,time) {
    const bend=Number(motion.spineBend)||0, flex=Number(motion.spineFlex)||0;
    const phase=Number(motion.gaitPhase)||0, speed=Number(motion.speed)||0;
    this.state.spineBend=damp(this.state.spineBend,bend,12,dt);
    this.state.spineFlex=damp(this.state.spineFlex,flex,12,dt);
    const meanHeight=Number(motion.bodyHeight);
    const shoulderHeight=Number(motion.shoulderHeight);
    const shoulderOffset=Number.isFinite(meanHeight)&&Number.isFinite(shoulderHeight)
      ? clamp((shoulderHeight-meanHeight)/(this.root.scale.x||1),-.025,.025)
      : 0;
    // A rigid torso rotation cannot bend the skin: it only slides the neck,
    // limbs and tail through their attachments. Keep this manifold aligned
    // until longitudinal skin weights drive a real spine deformation.
    this.anatomy.torso.group.rotation.y=damp(this.anatomy.torso.group.rotation.y,0,12,dt);
    this.anatomy.torso.group.rotation.x=damp(this.anatomy.torso.group.rotation.x,0,12,dt);
    this.anatomy.neck.group.rotation.y=damp(this.anatomy.neck.group.rotation.y,bend*.20,11,dt);
    this.anatomy.neck.group.position.y=damp(this.anatomy.neck.group.position.y,.030+shoulderOffset*.55,11,dt);
    this.anatomy.neck.group.position.z=damp(this.anatomy.neck.group.position.z,.170-Math.abs(flex)*.004,11,dt);
    this.headRig.position.y=damp(this.headRig.position.y,.078+shoulderOffset*.72+Math.abs(flex)*.002,11,dt);
    this.headRig.position.z=damp(this.headRig.position.z,.170-Math.abs(flex)*.005,11,dt);
    this.anatomy.spine.forEach((segment,index)=>{
      const t=index/(this.anatomy.spine.length-1)-.5;
      segment.group.rotation.y=damp(segment.group.rotation.y,bend*t*1.55,12,dt);
      segment.group.rotation.x=damp(segment.group.rotation.x,flex*Math.cos(t*Math.PI),12,dt);
      segment.group.position.x=segment.bindPosition.x+Math.sin(bend*t)*Math.abs(t)*.012;
      segment.group.position.y=segment.bindPosition.y+Math.cos(phase*TAU+t*3)*Math.min(.0025,speed*.0012)+Math.cos(t*Math.PI)*flex*.009;
      segment.group.position.z=segment.bindPosition.z;
    });
    for(const [record,offset] of [[this.anatomy.scapulaLeft,0],[this.anatomy.scapulaRight,.5]]) {
      const cycle=Math.sin((phase+offset)*TAU);
      const stride=cycle*clamp(speed/1.4)*.022;
      record.group.position.z=record.bindPosition.z+stride;
      record.group.position.y=record.bindPosition.y+Math.max(0,-cycle)*.008;
      record.group.rotation.x=-.17-stride*2.1;
    }
  }

  updateAttention(motion,cognition,dt,time) {
    const attention=cognition?.perception?.attention?.position;
    let yaw=0,pitch=Number(motion.headPitch)||0;
    if(attention) {
      const target=v3(attention);
      const headWorld=this.headRig.getWorldPosition(this.tmp.a);
      const direction=target.sub(headWorld);
      const horizontal=Math.hypot(direction.x,direction.z);
      yaw=Math.atan2(direction.x,direction.z)-(Number(motion.heading)||0);
      yaw=Math.atan2(Math.sin(yaw),Math.cos(yaw));
      pitch=-Math.atan2(direction.y,Math.max(.01,horizontal));
    } else {
      yaw=Math.sin(time*.37)*.12+Math.sin(time*.091)*.08;
      pitch+=(Math.sin(time*.29)*.025);
    }
    const distraction=clamp(cognition?.perception?.attention?.salience ?? .28);
    this.state.eyeYaw=dampAngle(this.state.eyeYaw,clamp(yaw,-.52,.52),18,dt);
    this.state.eyePitch=dampAngle(this.state.eyePitch,clamp(pitch,-.34,.28),16,dt);
    this.state.headYaw=dampAngle(this.state.headYaw,clamp(yaw,-.78,.78)*(attention?.x!==undefined ? .72 : .45),5.3+distraction*2,dt);
    this.state.headPitch=dampAngle(this.state.headPitch,clamp(pitch,-.42,.38),5.8,dt);
    this.headRig.rotation.y=this.state.headYaw+this.state.spineBend*.12;
    this.headRig.rotation.x=this.state.headPitch+this.state.spineFlex*.15;
    const earTarget=clamp(yaw,-.95,.95);
    this.state.leftEarYaw=dampAngle(this.state.leftEarYaw,earTarget+Math.sin(time*.41)*.08,11,dt);
    this.state.rightEarYaw=dampAngle(this.state.rightEarYaw,earTarget-Math.sin(time*.37)*.07,10,dt);
  }

  updateFace(motion,cognition,dt,time) {
    const fear=clamp(cognition?.needs?.fear ?? 0), stress=clamp(cognition?.needs?.stress ?? 0);
    const arousal=clamp(fear*.72+stress*.32+(motion.speed??0)/5);
    const pet=cognition?.pet;
    if(time>=this.state.nextBlink&&this.state.blinkPhase<0) this.state.blinkPhase=0;
    if(this.state.blinkPhase>=0) {
      this.state.blinkPhase+=dt*(pet?.active&&pet.preference>.6?2.1:5.8);
      this.state.blink=Math.sin(Math.min(1,this.state.blinkPhase)*Math.PI);
      if(this.state.blinkPhase>=1) {this.state.blinkPhase=-1;this.state.blink=0;this.state.nextBlink=time+lerp(2.1,5.8,seeded(Math.floor(time*7)));}
    }
    if(pet?.active&&pet.preference>.65) this.state.blink=Math.max(this.state.blink,smoothstep(0,.8,pet.duration??0)*.72);
    const daylight=.65+.35*Math.sin(((8.15+time/135)-6)/24*TAU);
    const pupilTarget=clamp(.16+(1-daylight)*.6+arousal*.54,.12,.92);
    this.state.pupil=damp(this.state.pupil,pupilTarget,4.2,dt);
    for(const eye of Object.values(this.eyes)) {
      eye.globeRig.rotation.y=eye.sign*.045+this.state.eyeYaw*.32;
      eye.globeRig.rotation.x=this.state.eyePitch*.28;
      eye.pupil.scale.x=lerp(.10,.86,Math.pow(this.state.pupil,1.45));
      eye.pupil.scale.y=lerp(1.05,.92,this.state.pupil);
      eye.upperLid.position.y=-this.state.blink*.0053;
      eye.lowerLid.position.y=this.state.blink*.0040;
      eye.upperLid.scale.y=1+this.state.blink*.12;
      eye.lowerLid.scale.y=1+this.state.blink*.10;
    }
    this.state.earFlatten=damp(this.state.earFlatten,clamp(fear*.82+stress*.28),7.5,dt);
    const flick=(Math.sin(time*5.7+Math.floor(time*.19)*9.1)>.985)?1:0;
    this.ears.left.rig.rotation.y=-.09+this.state.leftEarYaw*.58+flick*.28;
    this.ears.right.rig.rotation.y=.07+this.state.rightEarYaw*.58-flick*.19;
    this.ears.left.rig.rotation.z=-this.ears.left.sign*(.30+this.state.earFlatten*.67);
    this.ears.right.rig.rotation.z=-this.ears.right.sign*(.30+this.state.earFlatten*.67);
    this.ears.left.rig.rotation.x=-.10+this.state.earFlatten*.42;
    this.ears.right.rig.rotation.x=-.10+this.state.earFlatten*.42;
    this.state.whiskerProtract=damp(this.state.whiskerProtract,clamp(.12+arousal*.42+(cognition?.perception?.attention?.salience??0)*.3),7,dt);
    this.updateWhiskers();
  }

  updateWhiskers() {
    for(const sideData of Object.values(this.whiskers)) {
      for(const line of sideData.lines) {
        const base=line.userData.basePoints;
        if(!base) continue;
        const spread=this.state.whiskerProtract;
        const end=base.end.clone(); end.x+=sideData.sign*spread*.012; end.z+=spread*.007;
        const control=base.control.clone(); control.x+=sideData.sign*spread*.006; control.z+=spread*.005;
        const curve=new THREE.QuadraticBezierCurve3(base.root,control,end);
        line.geometry.setFromPoints(curve.getPoints(14));
      }
    }
  }

  updateLimbs(motion,dt,time) {
    this.root.updateMatrixWorld(true);
    const inverse=this.tmp.inverse.copy(this.root.matrixWorld).invert();
    // Limb meshes are root children while their proximal origins are authored
    // in body space. Applying the live body matrix carries lean, crouch,
    // terrain pitch, and bank into the root-local IK solve without applying the
    // root's world transform twice.
    this.body.updateMatrix();
    const pawForwardWorld=new THREE.Vector3(
      Math.sin(Number(motion.heading)||0),
      0,
      Math.cos(Number(motion.heading)||0),
    );
    const pawForwardLocal=pawForwardWorld.transformDirection(inverse).normalize();
    for(const key of LIMB_KEYS) {
      const limb=this.limbs[key], supplied=motion.feet?.[key];
      const neutralWorld=this.root.localToWorld(new THREE.Vector3(limb.side*(limb.front ? .045 : .043),.001,limb.front ? .175 : -.108));
      const footWorld=v3(supplied?.position,neutralWorld);
      const foot=footWorld.applyMatrix4(inverse);
      const normalWorld=v3(supplied?.normal,UP).normalize();
      const normalLocal=normalWorld.transformDirection(inverse).normalize();
      const anchorLocal=limb.anchor.clone();
      const sectionHeight=Number(limb.front?motion.shoulderHeight:motion.pelvisHeight);
      const meanHeight=Number(motion.bodyHeight);
      if(Number.isFinite(sectionHeight)&&Number.isFinite(meanHeight)) {
        anchorLocal.y+=clamp((sectionHeight-meanHeight)/(this.root.scale.x||1),-.04,.04);
      }
      if(limb.front&&limb.scapula) {
        anchorLocal.z+=(limb.scapula.group.position.z-limb.scapula.bindPosition.z)*.72;
        anchorLocal.y+=(limb.scapula.group.position.y-limb.scapula.bindPosition.y)*.45;
      }
      const shoulder=anchorLocal.applyMatrix4(this.body.matrix);
      const cycle=Math.sin((Number(supplied?.phase) || 0)*TAU);
      if(limb.front) {shoulder.z+=cycle*clamp((motion.speed??0)/2)*.004;shoulder.y+=Math.max(0,-cycle)*.003;}
      else shoulder.y+=Math.max(0,cycle)*.003;
      let distalTarget,pawBase;
      if(limb.front) {
        // Carpus and MCP are separate landmarks; the former implementation
        // skipped MCP and stretched one segment all the way to the ground.
        distalTarget=foot.clone().add(new THREE.Vector3(limb.side*.002,.031,-.042));
        pawBase=foot.clone().add(new THREE.Vector3(0,.005,-.022));
      } else {
        // Preserve the feline hock -> MTP -> toe reversal that creates the
        // characteristic digitigrade hind silhouette.
        distalTarget=foot.clone().add(new THREE.Vector3(limb.side*.005,.037,-.073));
        pawBase=foot.clone().add(new THREE.Vector3(0,.004,-.030));
      }
      const pole=limb.pole.clone().transformDirection(this.body.matrix);
      const joint=solveTwoBone(shoulder,distalTarget,limb.upper.baseLength,limb.lower.baseLength,pole,this.tmp.a,this.tmp.b);
      this.setSegment(limb.upper,shoulder,joint);
      this.setSegment(limb.lower,joint,distalTarget);
      this.setSegment(limb.metapodial,distalTarget,pawBase);
      limb.jointMass.group.position.copy(joint);
      limb.distalMass.group.position.copy(distalTarget);
      this.setPaw(limb.paw,foot,normalLocal,pawForwardLocal);
      limb.shoulder.copy(shoulder);limb.joint.copy(joint);limb.wrist.copy(distalTarget);limb.foot.copy(foot);limb.normal.copy(normalLocal);
      const clawAmount=(motion.jumpPhase&&motion.jumpPhase!=='none'&&motion.jumpPhase!=='airborne')||(motion.gait==='stalk'&&supplied?.swing>.7);
      limb.paw.claws.forEach(claw=>claw.visible=Boolean(clawAmount));
    }
  }

  setSegment(part,start,end) {
    const direction=end.clone().sub(start),length=Math.max(.001,direction.length());
    part.group.position.copy(start).add(end).multiplyScalar(.5);
    part.group.quaternion.setFromUnitVectors(UP,direction.normalize());
    part.group.scale.set(1,length/part.baseLength,1);
  }

  setPaw(paw,position,normal,forwardHint=FORWARD) {
    paw.group.position.copy(position).addScaledVector(normal,paw.contactOffset??.0075);
    // Both the paw and its target now live in root-local space. Reusing the
    // world heading here used to apply the yaw a second time after root yaw,
    // twisting paws away from their legs whenever the cat turned.
    const forward=forwardHint.clone();
    forward.addScaledVector(normal,-forward.dot(normal)).normalize();
    if(forward.lengthSq()<.01) forward.copy(FORWARD);
    const right=new THREE.Vector3().crossVectors(normal,forward).normalize();
    this.tmp.basis.makeBasis(right,normal,forward);
    paw.group.quaternion.setFromRotationMatrix(this.tmp.basis);
  }

  updateTail(motion,cognition,dt,time) {
    const fear=clamp(cognition?.needs?.fear??0), affection=clamp(cognition?.needs?.affection??.5);
    const pet=cognition?.pet;
    const balance=clamp(Number(motion.tailBalance)||0,-1,1);
    const speed=Number(motion.speed)||0;
    const liftTarget = pet?.active && pet.preference>.55
      ? .72
      : fear>.45
        ? .18
        : motion.gait==='run'||motion.gait==='sprint'
          ? .38
          : .26+affection*.12;
    this.state.tailLift=damp(this.state.tailLift,liftTarget,3.8,dt);
    this.state.tailSway=damp(this.state.tailSway,balance,8,dt);
    let start=new THREE.Vector3(0,.034,-.198).applyMatrix4(this.body.matrix);
    let yaw=this.state.tailSway*.48;
    let pitch=lerp(-.05,.58,this.state.tailLift);
    for(let i=0;i<this.tail.length;i++) {
      const segment=this.tail[i],t=i/(this.tail.length-1);
      yaw+=this.state.tailSway*(1-t)*.04+Math.sin(time*(1.1+speed*.4)+i*.42)*(.018+t*.013);
      pitch+=(-.055+this.state.tailLift*.025)-Math.sin(time*.83+i*.27)*.008;
      if(fear>.5) yaw+=Math.sin(time*14+i*.8)*fear*.022;
      const direction=new THREE.Vector3(Math.sin(yaw)*Math.cos(pitch),Math.sin(pitch),-Math.cos(yaw)*Math.cos(pitch)).normalize();
      const end=start.clone().addScaledVector(direction,segment.length);
      this.setSegment(segment.part,start,end);
      segment.start.copy(start);segment.end.copy(end);start=end;
    }
  }

  updateMicroMotion(motion,cognition,dt,time) {
    const energy=clamp(cognition?.needs?.energy??.75),stress=clamp(cognition?.needs?.stress??.1);
    const speed=Number(motion.speed)||0;
    const breathRate=lerp(1.35,2.6,clamp(speed/3+stress*.4));
    this.state.breath=Math.sin(time*breathRate)*lerp(.008,.017,1-energy);
    this.anatomy.torso.group.scale.x=this.anatomy.torso.bindScale.x*(1+this.state.breath*.22);
    this.anatomy.torso.group.scale.y=this.anatomy.torso.bindScale.y*(1+this.state.breath*.18);
    const pet=cognition?.pet;
    this.state.petLean=damp(this.state.petLean,pet?.active?clamp(pet.preference??.5):0,5,dt);
    if(pet?.active&&pet.point) {
      const point=v3(pet.point); this.root.worldToLocal(point);
      const lateral=clamp(point.x*.45,-.014,.014)*this.state.petLean;
      this.body.position.x=damp(this.body.position.x,lateral,6,dt);
      if((pet.part==='cheek'||pet.part==='head')&&pet.preference>.55) this.headRig.position.x=damp(this.headRig.position.x,lateral*.7,7,dt);
    } else {
      this.body.position.x=damp(this.body.position.x,0,5,dt);
      this.headRig.position.x=damp(this.headRig.position.x,0,5,dt);
    }
    const groom=cognition?.intention?.goal==='groom';
    if(groom&&speed<.05) {
      this.headRig.rotation.z=damp(this.headRig.rotation.z,.45+Math.sin(time*8.8)*.08,8,dt);
      this.headRig.rotation.x+=Math.sin(time*8.8)*.025;
    } else this.headRig.rotation.z=damp(this.headRig.rotation.z,0,7,dt);
  }

  updateDebug() {
    if(!this.debug.visible)return;
    for(const key of LIMB_KEYS) {
      const limb=this.limbs[key],points=[limb.shoulder,limb.joint,limb.wrist,limb.foot];
      this.debugJoints[key].forEach((marker,index)=>marker.position.copy(points[index]));
    }
  }

  getPettableMeshes() { return [...this.pettable]; }
  setDebug(enabled) { this.debug.visible=Boolean(enabled); }

  dispose() {
    this.root.removeFromParent();
    for(const geometry of this.geometries) geometry.dispose?.();
    for(const material of this.materials) disposeMaterial(material);
    this.geometries.clear();this.materials.clear();this.pettable.length=0;this.partRecords.length=0;
  }
}

function solveTwoBone(origin,target,lengthA,lengthB,pole,tempA=new THREE.Vector3(),tempB=new THREE.Vector3()) {
  const direction=tempA.copy(target).sub(origin);
  let distance=direction.length();
  if(distance<1e-5) direction.set(0,-1,0),distance=1e-5;
  direction.multiplyScalar(1/distance);
  const clamped=Math.min(lengthA+lengthB-.0001,Math.max(Math.abs(lengthA-lengthB)+.0001,distance));
  const along=(lengthA*lengthA-lengthB*lengthB+clamped*clamped)/(2*clamped);
  const height=Math.sqrt(Math.max(0,lengthA*lengthA-along*along));
  const poleDirection=tempB.copy(pole).addScaledVector(direction,-pole.dot(direction));
  if(poleDirection.lengthSq()<1e-6) poleDirection.set(1,0,0).addScaledVector(direction,-direction.x);
  poleDirection.normalize();
  return origin.clone().addScaledVector(direction,along).addScaledVector(poleDirection,height);
}

export default CatModel;
