import * as THREE from 'three';

const TAU = Math.PI * 2;

function signedPow(value, exponent) {
  return Math.sign(value) * Math.pow(Math.abs(value), exponent);
}

function averageRingSeamNormals(geometry,ringCount,ringStride) {
  const normal=geometry.getAttribute('normal');
  const blended=new THREE.Vector3();
  for(let ring=0;ring<ringCount;ring++) {
    const first=ring*ringStride,last=first+ringStride-1;
    blended.set(
      normal.getX(first)+normal.getX(last),
      normal.getY(first)+normal.getY(last),
      normal.getZ(first)+normal.getZ(last),
    ).normalize();
    normal.setXYZ(first,blended.x,blended.y,blended.z);
    normal.setXYZ(last,blended.x,blended.y,blended.z);
  }
  normal.needsUpdate=true;
}

/**
 * Closed longitudinal skin assembled from measured elliptical cross-sections.
 * Rings run caudal-to-cranial on +Z.  Unlike overlapped spheres, the result has
 * one continuous silhouette and one continuous normal field through pelvis,
 * waist, ribcage and thoracic inlet.
 */
function interpolateRings(rings, subdivisions) {
  if (subdivisions <= 1 || rings.length < 2) return rings;
  const result=[];
  for(let ringIndex=0;ringIndex<rings.length-1;ringIndex++) {
    const current=rings[ringIndex],next=rings[ringIndex+1];
    for(let step=0;step<subdivisions;step++) {
      const t=step/subdivisions;
      // Preserve every measured station while easing the intervening soft
      // tissue. Straight spans between only ten stations made the back and
      // abdomen visibly faceted in orthographic validation.
      const eased=t*t*(3-2*t);
      result.push({
        z:THREE.MathUtils.lerp(current.z,next.z,t),
        rx:THREE.MathUtils.lerp(current.rx,next.rx,eased),
        ry:THREE.MathUtils.lerp(current.ry,next.ry,eased),
        y:THREE.MathUtils.lerp(current.y ?? 0,next.y ?? 0,eased),
        power:THREE.MathUtils.lerp(current.power ?? 2,next.power ?? 2,eased),
      });
    }
  }
  result.push({...rings.at(-1)});
  return result;
}

export function createAnatomicalLoft(rings,radialSegments=32,longitudinalSubdivisions=4) {
  rings=interpolateRings(rings,longitudinalSubdivisions);
  const positions=[];
  const uvs=[];
  const indices=[];
  const ringStride=radialSegments+1;

  for(let ringIndex=0;ringIndex<rings.length;ringIndex++) {
    const ring=rings[ringIndex];
    const exponent=2/(ring.power ?? 2);
    for(let side=0;side<=radialSegments;side++) {
      const angle=side/radialSegments*TAU;
      const cosine=Math.cos(angle),sine=Math.sin(angle);
      const x=ring.rx*signedPow(cosine,exponent);
      const y=(ring.y ?? 0)+ring.ry*signedPow(sine,exponent);
      positions.push(x,y,ring.z);
      uvs.push(side/radialSegments,ringIndex/(rings.length-1));
    }
  }

  for(let ring=0;ring<rings.length-1;ring++) {
    for(let side=0;side<radialSegments;side++) {
      const a=ring*ringStride+side;
      const b=a+ringStride;
      indices.push(a,b,a+1,b,b+1,a+1);
    }
  }

  const firstCenter=positions.length/3;
  positions.push(0,rings[0].y ?? 0,rings[0].z);
  uvs.push(.5,0);
  const lastCenter=positions.length/3;
  const last=rings[rings.length-1];
  positions.push(0,last.y ?? 0,last.z);
  uvs.push(.5,1);
  for(let side=0;side<radialSegments;side++) {
    indices.push(firstCenter,side+1,side);
    const offset=(rings.length-1)*ringStride;
    indices.push(lastCenter,offset+side,offset+side+1);
  }

  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  averageRingSeamNormals(geometry,rings.length,ringStride);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

export function createTorsoGeometry() {
  return createAnatomicalLoft([
    {z:-.205,rx:.026,ry:.0275,y:.0025,power:2.0},
    {z:-.180,rx:.050,ry:.0450,y:.0020,power:2.0},
    {z:-.140,rx:.060,ry:.0545,y:.0025,power:2.18},
    {z:-.095,rx:.059,ry:.0570,y:.0030,power:2.22},
    {z:-.050,rx:.050,ry:.0455,y:.0045,power:2.05},
    {z:.000,rx:.054,ry:.0500,y:.0020,power:2.05},
    {z:.055,rx:.066,ry:.0630,y:-.0050,power:2.18},
    {z:.105,rx:.070,ry:.0700,y:-.0100,power:2.22},
    {z:.145,rx:.061,ry:.0645,y:-.0125,power:2.12},
    {z:.175,rx:.045,ry:.0465,y:-.0085,power:2.0},
  ],38);
}

export function createSkullGeometry() {
  return createAnatomicalLoft([
    {z:-.012,rx:.033,ry:.0255,y:-.0005},
    {z:.015,rx:.041,ry:.0360,y:.0020,power:2.12},
    {z:.045,rx:.048,ry:.0370,y:-.0020,power:2.16},
    {z:.068,rx:.040,ry:.0325,y:-.0065,power:2.08},
    {z:.086,rx:.032,ry:.0250,y:-.0130},
  ],34);
}

export function createNeckGeometry() {
  return createAnatomicalLoft([
    {z:-.052,rx:.036,ry:.039,y:-.008},
    {z:-.018,rx:.042,ry:.047,y:-.004},
    {z:.020,rx:.043,ry:.047,y:.006},
    {z:.050,rx:.034,ry:.036,y:.018},
  ],28);
}

export function createNasalBridgeGeometry() {
  return createAnatomicalLoft([
    {z:-.012,rx:.024,ry:.019,y:.004},
    {z:.014,rx:.022,ry:.017,y:.001},
    {z:.039,rx:.016,ry:.014,y:-.003},
    {z:.061,rx:.0105,ry:.009,y:-.007},
  ],24);
}

export function createJawGeometry() {
  return createAnatomicalLoft([
    {z:-.029,rx:.020,ry:.010,y:.004},
    {z:.000,rx:.0275,ry:.015,y:0},
    {z:.035,rx:.024,ry:.013,y:.001},
    {z:.058,rx:.0175,ry:.009,y:.004},
  ],24);
}

/** Tapered, softly muscled segment aligned to local +Y. */
export function createTaperedLimbGeometry(length,startRadius,endRadius,{depth=.9,bulge=.12,segments=9,radial=16}={}) {
  const positions=[];
  const uvs=[];
  const indices=[];
  const stride=radial+1;
  for(let row=0;row<=segments;row++) {
    const t=row/segments;
    const endRound=Math.pow(Math.sin(Math.PI*t),.32);
    const baseRadius=startRadius+(endRadius-startRadius)*t;
    const radius=baseRadius*(.86+bulge*Math.sin(Math.PI*t)+.14*endRound);
    const y=(t-.5)*length;
    for(let column=0;column<=radial;column++) {
      const angle=column/radial*TAU;
      positions.push(Math.cos(angle)*radius,y,Math.sin(angle)*radius*depth);
      uvs.push(column/radial,t);
    }
  }
  for(let row=0;row<segments;row++) for(let column=0;column<radial;column++) {
    const a=row*stride+column,b=a+stride;
    indices.push(a,a+1,b,b,a+1,b+1);
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  averageRingSeamNormals(geometry,segments+1,stride);
  geometry.computeBoundingSphere();
  return geometry;
}

export function createPawGeometry() {
  return createAnatomicalLoft([
    {z:-.026,rx:.010,ry:.007,y:.003},
    {z:-.016,rx:.0165,ry:.0095,y:.002,power:2.3},
    {z:.001,rx:.019,ry:.0105,y:0,power:2.5},
    {z:.017,rx:.017,ry:.0095,y:.001,power:2.4},
    {z:.026,rx:.009,ry:.0065,y:.002},
  ],24);
}

/** Closed, curved, bevelled external ear cartilage. */
export function createPinnaGeometry() {
  const shape=new THREE.Shape();
  shape.moveTo(-.018,0);
  shape.quadraticCurveTo(-.022,.015,-.015,.030);
  shape.quadraticCurveTo(-.008,.047,.001,.058);
  shape.quadraticCurveTo(.011,.047,.019,.029);
  shape.quadraticCurveTo(.023,.014,.020,0);
  shape.quadraticCurveTo(.001,-.006,-.018,0);
  const cavity=new THREE.Path();
  cavity.moveTo(-.011,.007);
  cavity.quadraticCurveTo(.001,.003,.012,.007);
  cavity.quadraticCurveTo(.016,.016,.012,.027);
  cavity.quadraticCurveTo(.006,.040,.001,.048);
  cavity.quadraticCurveTo(-.004,.042,-.010,.030);
  cavity.quadraticCurveTo(-.015,.018,-.011,.007);
  shape.holes.push(cavity);
  const geometry=new THREE.ExtrudeGeometry(shape,{
    depth:.015,
    steps:1,
    bevelEnabled:true,
    bevelThickness:.0023,
    bevelSize:.0018,
    bevelOffset:-.001,
    bevelSegments:3,
    curveSegments:12,
  });
  geometry.translate(0,0,-.0075);
  // Auricular cartilage is deepest at the conchal base and becomes almost
  // paper-thin at the apex; a constant extrusion reads as a vertical slab in
  // profile. Taper depth continuously while retaining the closed bevelled rim.
  const position=geometry.attributes.position;
  for(let index=0;index<position.count;index++) {
    const height=Math.max(0,Math.min(1,position.getY(index)/.058));
    position.setZ(index,position.getZ(index)*(1-height*.82));
  }
  // Bring the bevel-inclusive envelope back to the measured 42 x 58 x
  // approximately 14 mm pinna, then bow the cartilage rearward through its
  // height. The changing centreline is what removes the side-view slab.
  geometry.scale(.992,.922,.68);
  geometry.computeBoundingBox();
  const minY=geometry.boundingBox.min.y,maxY=geometry.boundingBox.max.y;
  for(let index=0;index<position.count;index++) {
    const height=Math.max(0,Math.min(1,(position.getY(index)-minY)/(maxY-minY)));
    const bow=.0027*Math.sin(height*Math.PI)-.0012*height;
    position.setZ(index,position.getZ(index)+bow);
  }
  position.needsUpdate=true;
  geometry.computeVertexNormals();
  return geometry;
}

export function createInnerPinnaGeometry() {
  const shape=new THREE.Shape();
  shape.moveTo(-.012,.006);
  shape.quadraticCurveTo(-.016,.019,-.009,.031);
  shape.quadraticCurveTo(-.004,.043,.001,.049);
  shape.quadraticCurveTo(.007,.041,.013,.028);
  shape.quadraticCurveTo(.017,.015,.013,.006);
  shape.quadraticCurveTo(.001,.002,-.012,.006);
  const geometry=new THREE.ShapeGeometry(shape,18);
  const position=geometry.getAttribute('position');
  for(let index=0;index<position.count;index++) {
    const x=position.getX(index),y=position.getY(index);
    const height=THREE.MathUtils.clamp((y-.003)/.046,0,1);
    const halfWidth=THREE.MathUtils.lerp(.013,.0035,height);
    const lateral=THREE.MathUtils.clamp(x/halfWidth,-1,1);
    // Recess the centre into a shallow conchal bowl while the perimeter meets
    // the raised rim. A flat pink plate falsely sealed the cavity.
    position.setZ(index,-.0045*(1-lateral*lateral)*Math.sin(height*Math.PI));
  }
  position.needsUpdate=true;
  geometry.computeVertexNormals();
  return geometry;
}

export function createNoseGeometry() {
  const shape=new THREE.Shape();
  shape.moveTo(-.0105,.003);
  shape.quadraticCurveTo(-.007,.006,0,.006);
  shape.quadraticCurveTo(.007,.006,.0105,.003);
  shape.quadraticCurveTo(.007,-.0055,0,-.006);
  shape.quadraticCurveTo(-.007,-.0055,-.0105,.003);
  const geometry=new THREE.ExtrudeGeometry(shape,{
    depth:.010,steps:1,bevelEnabled:true,bevelThickness:.0012,
    bevelSize:.0008,bevelSegments:3,curveSegments:8,
  });
  geometry.translate(0,0,-.005);
  geometry.computeVertexNormals();
  return geometry;
}

export function createEyelidGeometry(width,height,upper=true) {
  const points=[];
  for(let index=0;index<=12;index++) {
    const t=index/12;
    const x=(t-.5)*width*2;
    const arch=Math.sin(t*Math.PI)*height*(upper?1:-.72);
    points.push(new THREE.Vector3(x,arch,Math.cos((t-.5)*Math.PI)*.002));
  }
  const curve=new THREE.CatmullRomCurve3(points,false,'centripetal');
  // The lid margin is a fine fold around a buried globe. A thick tube reads
  // as a cartoon spectacle frame and falsely enlarges the eye aperture.
  return new THREE.TubeGeometry(curve,28,.00115,6,false);
}

/** Skin-colored orbital plate with a true almond aperture for a buried globe. */
export function createOrbitalMaskGeometry(
  apertureWidth=.0165,
  apertureHeight=.0115,
  outerWidth=.026,
  outerHeight=.022,
) {
  const shape=new THREE.Shape();
  shape.moveTo(-outerWidth*.5,0);
  shape.bezierCurveTo(-outerWidth*.45,outerHeight*.44,outerWidth*.28,outerHeight*.54,outerWidth*.5,0);
  shape.bezierCurveTo(outerWidth*.32,-outerHeight*.54,-outerWidth*.35,-outerHeight*.48,-outerWidth*.5,0);

  const aperture=new THREE.Path();
  aperture.moveTo(-apertureWidth*.5,0);
  aperture.quadraticCurveTo(-apertureWidth*.12,apertureHeight*.62,apertureWidth*.5,0);
  aperture.quadraticCurveTo(apertureWidth*.08,-apertureHeight*.58,-apertureWidth*.5,0);
  shape.holes.push(aperture);

  const geometry=new THREE.ShapeGeometry(shape,24);
  geometry.computeVertexNormals();
  return geometry;
}
