import * as THREE from 'three';
import furVertexShader from '../shaders/fur.vert.glsl?raw';
import furFragmentShader from '../shaders/fur.frag.glsl?raw';
import { COATS, EYE_COLORS } from '../data/catalog.js';
import { clamp, damp, dampAngle, lerp, smoothstep, TAU } from '../core/math.js';

const FORWARD = new THREE.Vector3(0, 0, 1);
const UP = new THREE.Vector3(0, 1, 0);
const SHELL_LAYERS = 8;
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
    this.debug = new THREE.Group();
    this.debug.name = 'Cat IK diagnostics';
    this.debug.visible = false;
    this.root.add(this.debug);
    this.tmp = {
      a:new THREE.Vector3(), b:new THREE.Vector3(), c:new THREE.Vector3(), d:new THREE.Vector3(),
      e:new THREE.Vector3(), q:new THREE.Quaternion(), matrix:new THREE.Matrix4(), normalMatrix:new THREE.Matrix3(),
    };
    this.state = {
      headYaw:0, headPitch:0, eyeYaw:0, eyePitch:0,
      leftEarYaw:0, rightEarYaw:0, earFlatten:0,
      blink:0, blinkPhase:-1, nextBlink:1.7,
      pupil:.38, breath:0, petLean:0, whiskerProtract:.1,
      tailSway:0, tailLift:.12,
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
    this.padMaterial = new THREE.MeshStandardMaterial({color:0x5b4648,roughness:.82,metalness:0});
    this.noseMaterial = new THREE.MeshPhysicalMaterial({color:0x6d4f51,roughness:.48,clearcoat:.16,clearcoatRoughness:.6});
    this.innerEarMaterial = new THREE.MeshStandardMaterial({color:0xa87978,roughness:.91,side:THREE.DoubleSide});
    this.clawMaterial = new THREE.MeshPhysicalMaterial({color:0xe8dfcf,roughness:.3,transmission:.08,thickness:.01});
    this.whiskerMaterial = new THREE.LineBasicMaterial({color:0xe9e2d5,transparent:true,opacity:.72});
    this.collarMaterial = new THREE.MeshPhysicalMaterial({color:0x4d796e,roughness:.42,metalness:.08,clearcoat:.18});
    this.metalMaterial = new THREE.MeshStandardMaterial({color:0xb9aa72,roughness:.3,metalness:.78});
    for (const material of [this.padMaterial,this.noseMaterial,this.innerEarMaterial,this.clawMaterial,this.whiskerMaterial,this.collarMaterial,this.metalMaterial]) this.materials.add(material);
  }

  createFurredPart({name,parent=this.body,geometry=ellipsoidGeometry(),position=[0,0,0],scale=[1,1,1],region=REGION.torso,petPart=name,shells=SHELL_LAYERS,seed=1}) {
    const group = new THREE.Group();
    group.name = name;
    group.position.set(...position);
    group.scale.set(...scale);
    parent.add(group);
    const furGeometry = addFurAttributes(geometry,region,seed);
    this.geometries.add(furGeometry);
    const base = new THREE.Mesh(furGeometry,this.shellMaterials[0]);
    base.name = `${name}-skin-and-undercoat`;
    base.castShadow=true; base.receiveShadow=true;
    base.userData.catPart=petPart;
    group.add(base);
    this.pettable.push(base);
    for(let layer=1;layer<=Math.min(SHELL_LAYERS,shells);layer++) {
      const shell=new THREE.Mesh(furGeometry,this.shellMaterials[layer]);
      shell.name=`${name}-fur-${layer}`;
      shell.renderOrder=layer;
      shell.frustumCulled=true;
      group.add(shell);
    }
    const record={name,group,base,geometry:furGeometry,region,petPart};
    this.partRecords.push(record);
    return record;
  }

  buildBody() {
    this.anatomy.pelvis=this.createFurredPart({name:'pelvis',position:[0,-.015,-.22],scale:[.17,.165,.205],petPart:'rump',shells:7,seed:2});
    this.anatomy.abdomen=this.createFurredPart({name:'flexible-abdomen',position:[0,-.015,-.02],scale:[.165,.17,.26],petPart:'belly',shells:8,seed:3});
    this.anatomy.ribcage=this.createFurredPart({name:'ribcage',position:[0,.015,.17],scale:[.185,.205,.255],petPart:'torso',shells:8,seed:4});
    this.anatomy.chest=this.createFurredPart({name:'deep-chest',position:[0,.02,.29],scale:[.18,.225,.17],petPart:'chest',shells:8,seed:5});
    this.anatomy.neck=this.createFurredPart({name:'neck-ruff',position:[0,.085,.355],scale:[.13,.16,.14],petPart:'neck',shells:8,seed:6});

    // A subtle dorsal chain makes flexion and moving scapular ridges visible.
    this.anatomy.spine=[];
    for(let i=0;i<6;i++) {
      const z=-.27+i*.105;
      const segment=this.createFurredPart({name:`spine-volume-${i}`,position:[0,.105,z],scale:[.135,.105,.105],petPart:'back',shells:5,seed:10+i});
      this.anatomy.spine.push(segment);
    }
    this.anatomy.scapulaLeft=this.createFurredPart({name:'left-mobile-scapula',position:[.145,.095,.235],scale:[.052,.15,.125],petPart:'back',shells:5,seed:20});
    this.anatomy.scapulaRight=this.createFurredPart({name:'right-mobile-scapula',position:[-.145,.095,.235],scale:[.052,.15,.125],petPart:'back',shells:5,seed:21});

    this.collar=new THREE.Group(); this.collar.name='collar'; this.collar.position.set(0,.06,.365); this.body.add(this.collar);
    const band=new THREE.Mesh(new THREE.TorusGeometry(.132,.012,7,38),this.collarMaterial);
    band.rotation.x=Math.PI/2; band.scale.y=1.08; band.castShadow=true; this.collar.add(band);
    const tag=new THREE.Mesh(new THREE.CylinderGeometry(.025,.025,.008,18),this.metalMaterial);
    tag.rotation.x=Math.PI/2; tag.position.set(0,-.135,.035); tag.castShadow=true; this.collar.add(tag);
  }

  buildHead() {
    this.headRig=new THREE.Group(); this.headRig.name='cervical-head-rig'; this.headRig.position.set(0,.17,.425); this.body.add(this.headRig);
    this.anatomy.skull=this.createFurredPart({name:'mesocephalic-skull',parent:this.headRig,position:[0,0,0],scale:[.145,.135,.155],region:REGION.face,petPart:'head',shells:8,seed:30});
    this.anatomy.cheekLeft=this.createFurredPart({name:'left-whisker-pad',parent:this.headRig,position:[.058,-.034,.126],scale:[.066,.054,.073],region:REGION.muzzle,petPart:'cheek',shells:5,seed:31});
    this.anatomy.cheekRight=this.createFurredPart({name:'right-whisker-pad',parent:this.headRig,position:[-.058,-.034,.126],scale:[.066,.054,.073],region:REGION.muzzle,petPart:'cheek',shells:5,seed:32});
    this.anatomy.chin=this.createFurredPart({name:'short-chin',parent:this.headRig,position:[0,-.092,.112],scale:[.065,.035,.067],region:REGION.muzzle,petPart:'muzzle',shells:3,seed:33});

    const nose=new THREE.Mesh(new THREE.SphereGeometry(1,18,11),this.noseMaterial);
    nose.name='nasal-leather'; nose.scale.set(.035,.024,.025); nose.position.set(0,-.037,.196); nose.castShadow=true;
    nose.userData.catPart='muzzle'; this.headRig.add(nose); this.pettable.push(nose); this.anatomy.nose=nose;
    const philtrum=new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0,-.055,.197),new THREE.Vector3(0,-.081,.178)]),
      new THREE.LineBasicMaterial({color:0x503f40,transparent:true,opacity:.55})
    );
    this.materials.add(philtrum.material); this.geometries.add(philtrum.geometry); this.headRig.add(philtrum);

    this.eyes={};
    for(const [side,sign] of [['left',1],['right',-1]]) this.eyes[side]=this.createEye(side,sign);
    this.ears={};
    for(const [side,sign] of [['left',1],['right',-1]]) this.ears[side]=this.createEar(side,sign);
    this.whiskers={left:this.createWhiskers(1),right:this.createWhiskers(-1)};
  }

  createEye(side,sign) {
    const rig=new THREE.Group(); rig.name=`${side}-eye-rig`; rig.position.set(sign*.064,.035,.132); this.headRig.add(rig);
    const scleraMat=new THREE.MeshPhysicalMaterial({color:0xe4dfcf,roughness:.18,clearcoat:1,clearcoatRoughness:.07});
    const irisMat=new THREE.MeshPhysicalMaterial({color:0x9ab56a,roughness:.34,metalness:.03,clearcoat:.65,clearcoatRoughness:.12});
    const pupilMat=new THREE.MeshBasicMaterial({color:0x040504});
    const corneaMat=new THREE.MeshPhysicalMaterial({color:0xdceff0,transparent:true,opacity:.17,roughness:.02,transmission:.4,thickness:.012,clearcoat:1});
    for(const material of [scleraMat,irisMat,pupilMat,corneaMat]) {this.materials.add(material);this.eyeMaterials.push(material);}
    const globe=new THREE.Mesh(new THREE.SphereGeometry(.052,24,18),scleraMat); globe.scale.set(.92,1,.77); globe.castShadow=true; rig.add(globe);
    const iris=new THREE.Mesh(new THREE.CircleGeometry(.035,28),irisMat); iris.position.z=.0415; rig.add(iris);
    const pupil=new THREE.Mesh(new THREE.CircleGeometry(.027,24),pupilMat); pupil.position.z=.043; pupil.scale.set(.18,1,1); rig.add(pupil);
    const catchlight=new THREE.Mesh(new THREE.CircleGeometry(.006,12),new THREE.MeshBasicMaterial({color:0xf8fff5,transparent:true,opacity:.72}));
    this.materials.add(catchlight.material); catchlight.position.set(-sign*.009,.012,.044); rig.add(catchlight);
    const cornea=new THREE.Mesh(new THREE.SphereGeometry(.053,24,12,0,TAU,0,Math.PI*.52),corneaMat); cornea.rotation.x=Math.PI/2; cornea.position.z=.010; cornea.scale.z=.72; rig.add(cornea);
    const lid=this.createFurredPart({name:`${side}-upper-eyelid`,parent:this.headRig,position:[sign*.064,.072,.142],scale:[.062,.017,.052],region:REGION.muzzle,petPart:'head',shells:2,seed:40+(sign>0?1:2)});
    return {rig,globe,iris,pupil,cornea,lid:lid.group,sign};
  }

  createEar(side,sign) {
    const rig=new THREE.Group(); rig.name=`${side}-pinna-rig`; rig.position.set(sign*.088,.095,.015); this.headRig.add(rig);
    const outer=this.createFurredPart({name:`${side}-thin-pinna`,parent:rig,geometry:earGeometry(),position:[0,0,0],scale:[1,1,1],region:REGION.ear,petPart:'ear',shells:3,seed:50+(sign>0?1:2)});
    const innerGeometry=earGeometry(); this.geometries.add(innerGeometry);
    const inner=new THREE.Mesh(innerGeometry,this.innerEarMaterial); inner.scale.set(.74,.78,.76); inner.position.set(0,.006,.008); inner.userData.catPart='ear'; rig.add(inner); this.pettable.push(inner);
    rig.rotation.z=-sign*.12;
    return {rig,outer,inner,sign};
  }

  createWhiskers(sign) {
    const group=new THREE.Group(); group.name=sign>0?'left-vibrissae':'right-vibrissae'; this.headRig.add(group);
    const lines=[];
    for(let row=0;row<4;row++) for(let column=0;column<3;column++) {
      const root=new THREE.Vector3(sign*(.085+column*.005),-.03-row*.014,.177-row*.006);
      const length=.19+row*.018+column*.012;
      const end=new THREE.Vector3(sign*(.09+length),-.015-row*.018,.13-row*.018);
      const control=root.clone().lerp(end,.5).add(new THREE.Vector3(sign*.018,.018-column*.006,.02));
      const curve=new THREE.QuadraticBezierCurve3(root,control,end);
      const geometry=new THREE.BufferGeometry().setFromPoints(curve.getPoints(14));
      this.geometries.add(geometry);
      const line=new THREE.Line(geometry,this.whiskerMaterial); line.userData.basePoints={root,control,end,row,column}; group.add(line); lines.push(line);
    }
    // Supraorbital whiskers are shorter and curve upward.
    for(let i=0;i<2;i++) {
      const root=new THREE.Vector3(sign*(.058+i*.015),.092,.119);
      const curve=new THREE.QuadraticBezierCurve3(root,root.clone().add(new THREE.Vector3(sign*.03,.055,.015)),root.clone().add(new THREE.Vector3(sign*.055,.105,-.005)));
      const geometry=new THREE.BufferGeometry().setFromPoints(curve.getPoints(10)); this.geometries.add(geometry);
      const line=new THREE.Line(geometry,this.whiskerMaterial); group.add(line); lines.push(line);
    }
    return {group,lines,sign};
  }

  buildLimbs() {
    const specs={
      frontLeft:{side:1,front:true,anchor:[.145,.055,.245],pole:[.08,-.02,-1],upper:.19,lower:.205,distal:.105},
      frontRight:{side:-1,front:true,anchor:[-.145,.055,.245],pole:[-.08,-.02,-1],upper:.19,lower:.205,distal:.105},
      hindLeft:{side:1,front:false,anchor:[.135,.005,-.235],pole:[.08,.02,1],upper:.225,lower:.235,distal:.14},
      hindRight:{side:-1,front:false,anchor:[-.135,.005,-.235],pole:[-.08,.02,1],upper:.225,lower:.235,distal:.14},
    };
    let seed=70;
    for(const [key,spec] of Object.entries(specs)) {
      const upper=this.createSegment(`${key}-proximal`,spec.front ? .058 : .072,spec.upper,'frontLeg',seed++);
      const lower=this.createSegment(`${key}-distal`,spec.front ? .041 : .047,spec.lower,spec.front?'frontLeg':'hindLeg',seed++);
      const metapodial=this.createSegment(`${key}-metapodial`,.027,spec.distal,spec.front?'frontLeg':'hindLeg',seed++);
      const paw=this.createPaw(key,spec,seed++);
      const scapula=spec.front?(spec.side>0?this.anatomy.scapulaLeft:this.anatomy.scapulaRight):null;
      this.limbs[key]={...spec,key,anchor:new THREE.Vector3(...spec.anchor),pole:new THREE.Vector3(...spec.pole),upper,lower,metapodial,paw,scapula,
        shoulder:new THREE.Vector3(),joint:new THREE.Vector3(),wrist:new THREE.Vector3(),foot:new THREE.Vector3(),normal:new THREE.Vector3(0,1,0)};
    }
  }

  createSegment(name,radius,length,petPart,seed) {
    const geometry=new THREE.CapsuleGeometry(radius,Math.max(.01,length-radius*2),6,12);
    const part=this.createFurredPart({name,parent:this.root,geometry,region:REGION.limb,petPart,shells:3,seed});
    part.baseLength=length;
    return part;
  }

  createPaw(key,spec,seed) {
    const group=new THREE.Group(); group.name=`${key}-paw-rig`; this.root.add(group);
    const paw=this.createFurredPart({name:`${key}-paw`,parent:group,geometry:ellipsoidGeometry(18),scale:[.047,.027,.063],region:REGION.limb,petPart:'paw',shells:3,seed});
    const pads=new THREE.Group(); pads.name=`${key}-pads`; group.add(pads);
    const central=new THREE.Mesh(new THREE.SphereGeometry(1,14,8),this.padMaterial);
    central.scale.set(.027,.007,.031); central.position.set(0,-.027,-.006); central.userData.catPart='paw'; pads.add(central); this.pettable.push(central);
    for(let digit=0;digit<4;digit++) {
      const digital=new THREE.Mesh(new THREE.SphereGeometry(1,12,7),this.padMaterial);
      digital.scale.set(.010,.0055,.014);
      digital.position.set((digit-1.5)*.017,-.027,.031+Math.abs(digit-1.5)*.002);
      digital.userData.catPart='paw'; pads.add(digital); this.pettable.push(digital);
      const claw=new THREE.Mesh(new THREE.ConeGeometry(.006,.025,7),this.clawMaterial);
      claw.name=`${key}-claw-${digit}`; claw.rotation.x=Math.PI/2; claw.position.set((digit-1.5)*.017,-.006,.067); claw.visible=false; pads.add(claw);
    }
    if(spec.front) {
      const carpal=new THREE.Mesh(new THREE.SphereGeometry(1,11,7),this.padMaterial);
      carpal.scale.set(.014,.006,.019); carpal.position.set(-spec.side*.018,-.014,-.064); carpal.userData.catPart='paw'; pads.add(carpal); this.pettable.push(carpal);
      const dewclaw=new THREE.Mesh(new THREE.ConeGeometry(.005,.021,7),this.clawMaterial);
      dewclaw.rotation.z=-spec.side*.75; dewclaw.position.set(-spec.side*.045,.015,-.035); pads.add(dewclaw);
    }
    return {group,paw,pads,claws:pads.children.filter(child=>child.material===this.clawMaterial)};
  }

  buildTail() {
    for(let i=0;i<14;i++) {
      const length=.064-i*.0018, radius=.037*(1-i/17)+.004;
      const segment=this.createSegment(`tail-segment-${i}`,radius,length,'tail',110+i);
      // Tail shader needs its own regional flow/pattern rules.
      const regionArray=segment.geometry.attributes.aCatRegion.array; regionArray.fill(REGION.tail); segment.geometry.attributes.aCatRegion.needsUpdate=true;
      segment.group.parent.remove(segment.group); this.root.add(segment.group);
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
    this.sharedUniforms.uBaseColor.value.copy(color(coat.base));
    this.sharedUniforms.uDarkColor.value.copy(color(coat.dark));
    this.sharedUniforms.uWarmColor.value.copy(color(coat.warm));
    this.sharedUniforms.uPattern.value=PATTERN[coat.pattern] ?? 0;
    const furAmount=clamp(Number(this.profile.furLength ?? .42));
    this.sharedUniforms.uFurLength.value=lerp(.0065,.027,furAmount);
    this.sharedUniforms.uFurDensity.value=lerp(.78,1.08,furAmount);
    this.root.scale.setScalar(clamp(Number(this.profile.bodySize ?? 1),.82,1.18));
    this.collar.visible=this.profile.collar!==false;
    this.guardMaterial.color.copy(color(coat.warm)).lerp(color(coat.base),.6);
    this.guardMaterial.opacity=lerp(.30,.68,furAmount);
    for(const eye of Object.values(this.eyes)) {
      eye.iris.material.color.copy(color(eyes.iris));
      eye.iris.material.emissive?.copy?.(color(eyes.rim));
      if(eye.iris.material.emissiveIntensity!==undefined) eye.iris.material.emissiveIntensity=.055;
    }
  }

  update(motion={},cognition={},dt=1/60,time=0) {
    dt=clamp(Number(dt)||0,0,.1);
    const scale=Math.max(.001,this.root.scale.x||1);
    const position=v3(motion.position,this.root.position);
    this.root.position.copy(position);
    this.root.rotation.y=dampAngle(this.root.rotation.y,Number(motion.heading)||0,20,dt);
    const bodyHeight=(Number(motion.bodyHeight)>.15?Number(motion.bodyHeight):.46*scale)/scale;
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
    this.updateLimbs(motion,dt,time);
    this.updateTail(motion,cognition,dt,time);
    this.updateMicroMotion(motion,cognition,dt,time);
    this.updateDebug();
    this.root.updateMatrixWorld(true);
    this.catWorld.copy(this.root.matrixWorld);
    this.catWorldInverse.copy(this.root.matrixWorld).invert();
  }

  updateSpine(motion,dt,time) {
    const bend=Number(motion.spineBend)||0, flex=Number(motion.spineFlex)||0;
    const phase=Number(motion.gaitPhase)||0, speed=Number(motion.speed)||0;
    this.anatomy.spine.forEach((segment,index)=>{
      const t=index/(this.anatomy.spine.length-1)-.5;
      segment.group.rotation.y=damp(segment.group.rotation.y,bend*t*1.55,12,dt);
      segment.group.rotation.x=damp(segment.group.rotation.x,flex*Math.cos(t*Math.PI),12,dt);
      segment.group.position.x=Math.sin(bend*t)*Math.abs(t)*.055;
      segment.group.position.y=.105+Math.cos(phase*TAU+t*3)*Math.min(.007,speed*.0025)+Math.cos(t*Math.PI)*flex*.035;
    });
    this.anatomy.pelvis.group.rotation.y=damp(this.anatomy.pelvis.group.rotation.y,-bend*.36,10,dt);
    this.anatomy.ribcage.group.rotation.y=damp(this.anatomy.ribcage.group.rotation.y,bend*.26,10,dt);
    this.anatomy.abdomen.group.scale.y=damp(this.anatomy.abdomen.group.scale.y,.17*(1+Math.abs(flex)*.12),8,dt);
    const scapulaCycle=Math.sin((phase+(speed>.05 ? .06 : 0))*TAU);
    for(const [record,offset] of [[this.anatomy.scapulaLeft,0],[this.anatomy.scapulaRight,.5]]) {
      const stride=Math.sin((phase+offset)*TAU)*clamp(speed/1.4)*.025;
      record.group.position.z=.235+stride;
      record.group.position.y=.095+Math.max(0,-Math.sin((phase+offset)*TAU))*.018;
      record.group.rotation.x=-stride*1.8+scapulaCycle*.015;
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
    this.headRig.rotation.y=this.state.headYaw;
    this.headRig.rotation.x=this.state.headPitch;
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
      eye.rig.rotation.y=this.state.eyeYaw*.43;
      eye.rig.rotation.x=this.state.eyePitch*.38;
      eye.pupil.scale.x=lerp(.10,.86,Math.pow(this.state.pupil,1.45));
      eye.pupil.scale.y=lerp(1.05,.92,this.state.pupil);
      eye.lid.position.y=.072-this.state.blink*.050;
      eye.lid.scale.y=.017*(1+this.state.blink*1.6);
    }
    this.state.earFlatten=damp(this.state.earFlatten,clamp(fear*.82+stress*.28),7.5,dt);
    const flick=(Math.sin(time*5.7+Math.floor(time*.19)*9.1)>.985)?1:0;
    this.ears.left.rig.rotation.y=this.state.leftEarYaw*.58+flick*.28;
    this.ears.right.rig.rotation.y=this.state.rightEarYaw*.58-flick*.19;
    this.ears.left.rig.rotation.z=-.12-this.state.earFlatten*.95;
    this.ears.right.rig.rotation.z=.12+this.state.earFlatten*.95;
    this.ears.left.rig.rotation.x=this.state.earFlatten*.42;
    this.ears.right.rig.rotation.x=this.state.earFlatten*.42;
    this.state.whiskerProtract=damp(this.state.whiskerProtract,clamp(.12+arousal*.42+(cognition?.perception?.attention?.salience??0)*.3),7,dt);
    this.updateWhiskers();
  }

  updateWhiskers() {
    for(const sideData of Object.values(this.whiskers)) {
      for(const line of sideData.lines) {
        const base=line.userData.basePoints;
        if(!base) continue;
        const spread=this.state.whiskerProtract;
        const end=base.end.clone(); end.x+=sideData.sign*spread*.038; end.z+=spread*.022;
        const control=base.control.clone(); control.x+=sideData.sign*spread*.018; control.z+=spread*.015;
        const curve=new THREE.QuadraticBezierCurve3(base.root,control,end);
        line.geometry.setFromPoints(curve.getPoints(14));
      }
    }
  }

  updateLimbs(motion,dt,time) {
    this.root.updateMatrixWorld(true);
    const inverse=this.tmp.matrix.copy(this.root.matrixWorld).invert();
    for(const key of LIMB_KEYS) {
      const limb=this.limbs[key], supplied=motion.feet?.[key];
      const neutralWorld=this.root.localToWorld(new THREE.Vector3(limb.side*.14,.025,limb.front ? .31 : -.28));
      const footWorld=v3(supplied?.position,neutralWorld);
      const foot=footWorld.applyMatrix4(inverse);
      const normalWorld=v3(supplied?.normal,UP).normalize();
      const normalLocal=normalWorld.transformDirection(inverse).normalize();
      const shoulder=limb.anchor.clone(); shoulder.y+=this.body.position.y;
      const cycle=Math.sin(((motion.gaitPhase??0)+(key==='frontRight' ? .25 : key==='hindLeft' ? .5 : key==='hindRight' ? .75 : 0))*TAU);
      if(limb.front) {shoulder.z+=cycle*clamp((motion.speed??0)/2)*.018;shoulder.y+=Math.max(0,-cycle)*.012;}
      else shoulder.y+=Math.max(0,cycle)*.01;
      let distalTarget;
      if(limb.front) distalTarget=foot.clone().add(new THREE.Vector3(0,.095,-.018));
      else distalTarget=foot.clone().add(new THREE.Vector3(0,.13,-.052));
      const joint=solveTwoBone(shoulder,distalTarget,limb.upper,limb.lower,limb.pole,this.tmp.a,this.tmp.b);
      this.setSegment(limb.upper,shoulder,joint);
      this.setSegment(limb.lower,joint,distalTarget);
      this.setSegment(limb.metapodial,distalTarget,foot);
      this.setPaw(limb.paw,foot,normalLocal,Number(motion.heading)||0);
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

  setPaw(paw,position,normal,heading) {
    paw.group.position.copy(position).addScaledVector(normal,.027);
    const forward=new THREE.Vector3(Math.sin(heading),0,Math.cos(heading));
    forward.addScaledVector(normal,-forward.dot(normal)).normalize();
    if(forward.lengthSq()<.01) forward.copy(FORWARD);
    const right=new THREE.Vector3().crossVectors(normal,forward).normalize();
    this.tmp.matrix.makeBasis(right,normal,forward);
    paw.group.quaternion.setFromRotationMatrix(this.tmp.matrix);
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
    let start=new THREE.Vector3(0,this.body.position.y+.02,-.395);
    let yaw=this.state.tailSway*.48;
    let pitch=lerp(-.22,.62,this.state.tailLift);
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
    this.anatomy.ribcage.group.scale.x=.185*(1+this.state.breath);
    this.anatomy.ribcage.group.scale.y=.205*(1+this.state.breath*.65);
    const pet=cognition?.pet;
    this.state.petLean=damp(this.state.petLean,pet?.active?clamp(pet.preference??.5):0,5,dt);
    if(pet?.active&&pet.point) {
      const point=v3(pet.point); this.root.worldToLocal(point);
      const lateral=clamp(point.x*2,-.08,.08)*this.state.petLean;
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
