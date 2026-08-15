import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CAT_SKIN_PART_BY_REGION,
  CAT_SKIN_QUALITY,
  CAT_SKIN_LANDMARKS,
  generateContinuousCatSkinGeometry,
} from '../src/simulation/cat-skin.js';

test('continuous cat skin is one finite, closed, weighted anatomical manifold', () => {
  const { geometry, stats } = generateContinuousCatSkinGeometry({ quality:'low' });
  try {
    assert.deepEqual(stats.resolution, CAT_SKIN_QUALITY.low);
    assert.ok(stats.vertices > 20_000);
    assert.ok(stats.triangles > 40_000);
    assert.equal(stats.bones, 38);
    assert.deepEqual(
      ['pelvis','lumbar','thorax'].map(name=>geometry.userData.catSkin.boneNames.includes(name)),
      [true,true,true],
    );

    const position=geometry.getAttribute('position');
    const normal=geometry.getAttribute('normal');
    const weights=geometry.getAttribute('skinWeight');
    const indices=geometry.getAttribute('skinIndex');
    const regions=geometry.getAttribute('aCatRegion');
    assert.equal(normal.count,position.count);
    assert.equal(weights.count,position.count);
    assert.equal(indices.count,position.count);
    assert.equal(regions.count,position.count);

    const represented=new Set();
    for(let vertex=0;vertex<position.count;vertex++) {
      let total=0;
      for(let influence=0;influence<4;influence++) {
        const weight=weights.getComponent(vertex,influence);
        const bone=indices.getComponent(vertex,influence);
        assert.ok(Number.isFinite(weight) && weight >= 0);
        assert.ok(Number.isInteger(bone) && bone >= 0 && bone < stats.bones);
        total+=weight;
      }
      assert.ok(Math.abs(total-1)<1e-5,`vertex ${vertex} weights total ${total}`);
      represented.add(Math.round(regions.getX(vertex)));
    }
    assert.deepEqual([...represented].sort((a,b)=>a-b),CAT_SKIN_PART_BY_REGION.map((_,index)=>index));

    const edgeUse=new Map();
    const triangles=geometry.index.array;
    for(let offset=0;offset<triangles.length;offset+=3) {
      const triangle=[triangles[offset],triangles[offset+1],triangles[offset+2]];
      assert.equal(new Set(triangle).size,3,`triangle ${offset/3} is non-degenerate`);
      for(let edge=0;edge<3;edge++) {
        const a=triangle[edge],b=triangle[(edge+1)%3];
        const key=a<b?`${a}:${b}`:`${b}:${a}`;
        edgeUse.set(key,(edgeUse.get(key) ?? 0)+1);
      }
    }
    for(const [edge,count] of edgeUse) assert.equal(count,2,`open or non-manifold edge ${edge}`);
  } finally {
    geometry.dispose();
  }
});

test('continuous silhouette preserves compact feline head, waist, croup, and paw envelopes', () => {
  const torso=CAT_SKIN_LANDMARKS.torsoRings;
  const skull=CAT_SKIN_LANDMARKS.skullRings;
  const station=(rings,z)=>rings.find(ring=>Math.abs(ring.z-z)<1e-6);
  assert.equal(Math.max(...torso.map(ring=>ring.rx*2)),0.142,'thorax width');
  assert.equal(station(torso,-0.045).rx*2,0.094,'lumbar waist width');
  assert.equal(station(torso,-0.125).rx*2,0.132,'pelvis width');
  assert.ok(Math.abs(station(torso,0.108).y+station(torso,0.108).ry-0.070)<1e-9,'withers line');
  assert.ok(station(torso,-0.045).y-station(torso,-0.045).ry>=-0.030,'abdominal tuck');
  assert.ok(station(torso,0.108).y-station(torso,0.108).ry<=-0.070,'deep thorax');
  assert.equal(Math.max(...skull.map(ring=>ring.rx*2)),0.100,'compact cranium width');

  const {geometry}=generateContinuousCatSkinGeometry({quality:'low'});
  try {
    const position=geometry.getAttribute('position');
    const region=geometry.getAttribute('aCatRegion');
    const boundsFor=predicate=>{
      const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
      for(let vertex=0;vertex<position.count;vertex++) {
        const point=[position.getX(vertex),position.getY(vertex),position.getZ(vertex)];
        if(!predicate(Math.round(region.getX(vertex)),point)) continue;
        for(let axis=0;axis<3;axis++) {min[axis]=Math.min(min[axis],point[axis]);max[axis]=Math.max(max[axis],point[axis]);}
      }
      return {min,max,size:max.map((value,axis)=>value-min[axis])};
    };
    const head=boundsFor(label=>label===1);
    assert.ok(head.size[2]<=0.105,`head skin length ${head.size[2]}`);
    assert.ok(head.max[2]-0.212<=0.036,`eye-plane to muzzle ${head.max[2]-0.212}`);
    const leftForePaw=boundsFor((label,point)=>label===4&&point[0]<0&&point[2]>0.12);
    assert.ok(leftForePaw.size[0]<=0.031,`forepaw width ${leftForePaw.size[0]}`);
    assert.ok(leftForePaw.size[2]<=0.045,`forepaw length ${leftForePaw.size[2]}`);
  } finally {
    geometry.dispose();
  }
});
