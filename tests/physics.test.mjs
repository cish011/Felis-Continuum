import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ToyPhysics } from '../src/simulation/physics.js';

function flatEnvironment() {
  return {
    obstacles: [],
    sampleSurface() {
      return { y:0, height:0, normal:new THREE.Vector3(0,1,0), friction:.8, type:'floor' };
    },
    roomAt() { return 'test-room'; },
  };
}

test('deterministic toys settle on the sampled surface without tunnelling', () => {
  const physics=new ToyPhysics(new THREE.Scene(),flatEnvironment(),{
    preferRapier:false,
    fixedStep:1/120,
    maxSubsteps:8,
  });
  const ball=physics.createBall(new THREE.Vector3(0,1.2,0),{radius:.06,restitution:.35});
  for(let i=0;i<1200;i++)physics.update(1/120);

  assert.ok(Number.isFinite(ball.position.y));
  assert.ok(Math.abs(ball.position.y-ball.radius)<.003,`expected y=${ball.radius}, received ${ball.position.y}`);
  assert.equal(ball.grounded,true);
  assert.ok(ball.sleeping||ball.velocity.length()<.02);
  physics.dispose();
});

test('deterministic fallback resolves toy-to-toy impacts', () => {
  const environment={obstacles:[],sampleSurface(){return null;},roomAt(){return 'void';}};
  const physics=new ToyPhysics(new THREE.Scene(),environment,{gravity:0,fixedStep:1/240,maxSubsteps:8});
  const left=physics.createBall(new THREE.Vector3(-.09,.5,0),{radius:.1,restitution:.8,linearDrag:0});
  const right=physics.createBall(new THREE.Vector3(.09,.5,0),{radius:.1,restitution:.8,linearDrag:0});
  left.velocity.set(1,0,0);
  right.velocity.set(-1,0,0);

  physics.update(1/120);

  assert.ok(left.velocity.x<0,'left toy should rebound to the left');
  assert.ok(right.velocity.x>0,'right toy should rebound to the right');
  assert.equal(left.lastCollision,right.id);
  assert.equal(right.lastCollision,left.id);
  physics.dispose();
});

test('held Rapier bodies return to dynamic state for toss and release', () => {
  const physics=new ToyPhysics(new THREE.Scene(),flatEnvironment(),{preferRapier:false});
  physics._rapier={RigidBodyType:{Dynamic:'dynamic',KinematicPositionBased:'kinematic'}};
  const calls=[];
  const fakeRigidBody={
    setBodyType(value){calls.push(['type',value]);},
    setNextKinematicTranslation(value){calls.push(['next',{...value}]);},
    setTranslation(value){calls.push(['position',{...value}]);},
    setLinvel(value){calls.push(['linear',{...value}]);},
    setAngvel(value){calls.push(['angular',{...value}]);},
    wakeUp(){calls.push(['wake']);},
  };
  const ball=physics.createBall(new THREE.Vector3());
  ball.rapierBody=fakeRigidBody;

  physics.hold(ball,new THREE.Vector3(1,2,3));
  physics.hold(ball,new THREE.Vector3(2,2,3));
  assert.equal(calls.filter(call=>call[0]==='type'&&call[1]==='kinematic').length,1,
    'repeated held-position updates should not repeatedly change body type');

  physics.toss(ball,{position:new THREE.Vector3(4,2,1),velocity:new THREE.Vector3(3,1,0)});
  assert.ok(calls.some(call=>call[0]==='type'&&call[1]==='dynamic'));
  assert.deepEqual(calls.findLast(call=>call[0]==='position')[1],{x:4,y:2,z:1});
  assert.deepEqual(calls.findLast(call=>call[0]==='linear')[1],{x:3,y:1,z:0});

  physics.hold(ball,new THREE.Vector3(-1,1,2));
  physics.release(ball,new THREE.Vector3(.5,0,0));
  assert.deepEqual(calls.findLast(call=>call[0]==='position')[1],{x:-1,y:1,z:2});
  assert.deepEqual(calls.findLast(call=>call[0]==='linear')[1],{x:.5,y:0,z:0});
  physics.dispose();
});

test('rotated door collider uses its oriented panel instead of its broad world AABB', () => {
  const panel=new THREE.Mesh(new THREE.BoxGeometry(1,1,.06));
  panel.position.y=.5;
  panel.rotation.y=Math.PI/4;
  panel.updateWorldMatrix(true,true);
  const bounds=new THREE.Box3().setFromObject(panel);
  const obstacle={
    id:'door',type:'door',dynamic:true,colliderObject:panel,
    min:bounds.min.clone(),max:bounds.max.clone(),enabled:true,
  };
  const environment=flatEnvironment();
  environment.obstacles=[obstacle];
  const physics=new ToyPhysics(new THREE.Scene(),environment,{gravity:0});
  const ball=physics.createBall(new THREE.Vector3(),{radius:.04});

  const outsidePanel=new THREE.Vector3(0,.5,.22).applyMatrix4(panel.matrixWorld);
  ball.position.copy(outsidePanel);
  physics._resolveObstacles(ball,1/120,true);
  assert.equal(ball.lastCollision,null,'point inside the world AABB but outside the panel must stay clear');

  const touchingPanel=new THREE.Vector3(0,.5,.04).applyMatrix4(panel.matrixWorld);
  ball.position.copy(touchingPanel);
  physics._resolveObstacles(ball,1/120,true);
  assert.equal(ball.lastCollision,'door');
  physics.dispose();
});

test('real Rapier backend launches a previously held toy', {timeout:15000}, async t => {
  const physics=await ToyPhysics.create(new THREE.Scene(),flatEnvironment(),{preferRapier:true});
  t.after(()=>physics.dispose());
  assert.equal(physics.backend,'rapier-wasm');
  const ball=physics.createBall(new THREE.Vector3(0,.8,0));
  physics.hold(ball,new THREE.Vector3(0,.8,0));
  physics.update(1/60);
  physics.toss(ball,{position:new THREE.Vector3(0,.8,0),velocity:new THREE.Vector3(2,0,0)});
  physics.update(1/30);
  assert.ok(ball.position.x>.02,`expected a launched dynamic body, received x=${ball.position.x}`);
  assert.equal(ball.held,false);
});
