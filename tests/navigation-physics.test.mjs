import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { NavigationSystem } from '../src/simulation/navigation.js';
import { GoalExecutor } from '../src/simulation/goal-executor.js';

const groundResult=()=>({height:0,y:0,normal:new THREE.Vector3(0,1,0),walkable:true,width:Infinity});

function planeEnvironment(obstacles=[]) {
  return {obstacles,surfaces:[],sampleSurface(){return groundResult();}};
}

test('navigation stays on the current floor beneath overhead furniture', () => {
  const tabletop={
    id:'tabletop',
    min:new THREE.Vector3(-.7,.72,-.7),
    max:new THREE.Vector3(.7,.84,.7),
  };
  const environment={
    obstacles:[tabletop],
    sampleSurface(x,z,options={}) {
      const candidates=[0];
      if(Math.abs(x)<=.7&&Math.abs(z)<=.7)candidates.push(.84);
      const ceiling=Number.isFinite(options?.referenceY)
        ? options.referenceY+(options.maxStep??Infinity)
        : Infinity;
      const height=Math.max(...candidates.filter(value=>value<=ceiling+.001));
      return {height,y:height,normal:new THREE.Vector3(0,1,0),walkable:true,width:Infinity};
    },
  };
  const navigation=new NavigationSystem(environment);
  const beneath=navigation.sampleSurface(new THREE.Vector3(0,0,0));
  assert.equal(beneath.height,0,'surface sampling must not snap from floor to tabletop');
  assert.equal(navigation.isBlocked(new THREE.Vector3(0,0,0),.17,{
    from:new THREE.Vector3(-1,0,0),maxStep:.24,bodyHeight:.31,
  }),false,'a cat-height body should fit under a tabletop with clear headroom');

  const onTop=navigation.sampleSurface(new THREE.Vector3(0,.84,0));
  assert.equal(onTop.height,.84);
  assert.equal(navigation.isBlocked(onTop.position,.17,{from:onTop.position,maxStep:.24}),false);
});

test('navigation tests a rotated door panel as an OBB', () => {
  const panel=new THREE.Mesh(new THREE.BoxGeometry(1,1,.06));
  panel.position.y=.5;
  panel.rotation.y=Math.PI/4;
  panel.updateWorldMatrix(true,true);
  const bounds=new THREE.Box3().setFromObject(panel);
  const obstacle={id:'door',type:'door',dynamic:true,enabled:true,colliderObject:panel,min:bounds.min,max:bounds.max};
  const navigation=new NavigationSystem(planeEnvironment([obstacle]));

  const clearPoint=new THREE.Vector3(0,0,.24).applyMatrix4(panel.matrixWorld);
  const blockedPoint=new THREE.Vector3(0,0,.025).applyMatrix4(panel.matrixWorld);
  clearPoint.y=0;
  blockedPoint.y=0;
  assert.equal(navigation.isBlocked(clearPoint,.04,{bodyHeight:.3}),false);
  assert.equal(navigation.isBlocked(blockedPoint,.04,{bodyHeight:.3}),true);

  obstacle.enabled=false;
  assert.equal(navigation.isBlocked(blockedPoint,.04,{bodyHeight:.3}),false);
});

test('invalid pathfinding options are sanitized before A-star expansion', () => {
  const wall={min:new THREE.Vector3(-.1,0,-.45),max:new THREE.Vector3(.1,1,.45)};
  const navigation=new NavigationSystem(planeEnvironment([wall]));
  const path=navigation.findPath(new THREE.Vector3(-1,0,0),new THREE.Vector3(1,0,0),{
    cellSize:0,
    radius:-10,
    maxStep:NaN,
    maxNodes:NaN,
    margin:-Infinity,
  });
  assert.ok(path.length>=2);
  assert.ok(path.every(point=>Number.isFinite(point.x)&&Number.isFinite(point.y)&&Number.isFinite(point.z)));
  assert.ok(path.some(point=>Math.abs(point.z)>.45),'path should route around the wall');
});

class StubLocomotion {
  constructor() {
    this.position=new THREE.Vector3();
    this.heading=0;
    this.speed=0;
    this.velocity=new THREE.Vector3();
    this.jumpPhase='none';
    this.target=null;
  }
  clearTarget(){this.target=null;}
  setTarget(target){this.target=target.clone();return [this.position.clone(),this.target.clone()];}
  launchJump(){return false;}
  update(){return this.getMotionState();}
  getPath(){return this.target?[this.position.clone(),this.target.clone()]:[];}
  getMotionState(){return {position:this.position.clone(),heading:this.heading,velocity:this.velocity.clone(),speed:0,feet:{},gait:'idle'};}
}

test('play target stays at the real toy and is predicted only for navigation', () => {
  const locomotion=new StubLocomotion();
  const body={id:'ball-1',position:new THREE.Vector3(2,0,0),velocity:new THREE.Vector3(1,0,0)};
  const executor=new GoalExecutor({locomotion,environment:planeEnvironment(),toyPhysics:{toys:[body]}});
  executor.goal='play';
  executor.targetId=body.id;
  const target=executor.resolveDynamicTarget({plan:{target:{id:body.id,position:body.position}}});
  assert.deepEqual(target.toArray(),[2,0,0]);
  assert.notEqual(target,body.position,'executor should not expose the mutable physics vector');
});

test('flee target remains stable when a later snapshot omits threat coordinates', () => {
  const locomotion=new StubLocomotion();
  const executor=new GoalExecutor({locomotion,environment:planeEnvironment(),toyPhysics:{toys:[]}});
  const first={intention:{goal:'flee'},plan:{id:'flee-plan',target:{id:'noise',position:{x:1,y:0,z:0}}}};
  executor.update(1/60,first);
  const safety=executor.target.clone();
  assert.ok(safety.x<0);

  const second={intention:{goal:'flee'},plan:{id:'flee-plan',target:{id:'noise'}}};
  executor.update(1/60,second);
  assert.ok(executor.target.distanceTo(safety)<1e-8,'safety target must not flip across the cat');
});

test('first executor update after a pickup resumes instead of freezing forever', () => {
  const locomotion=new StubLocomotion();
  const executor=new GoalExecutor({locomotion,environment:planeEnvironment(),toyPhysics:{toys:[]}});
  executor.goal='observe';
  executor.planId='observe-plan';
  executor.interrupt('pickup',{position:new THREE.Vector3()});
  const result=executor.update(1/60,{intention:{goal:'observe'},plan:{id:'observe-plan'}});
  assert.equal(executor.interruption,null);
  assert.equal(result.activity,'observe');
});

test('intermediate jump points are inset onto the support surface', () => {
  const executor=new GoalExecutor({locomotion:new StubLocomotion(),environment:planeEnvironment(),toyPhysics:{toys:[]}});
  const surface={minX:0,maxX:1,minZ:0,maxZ:1,y:.8};
  const point=executor.closestPointOnSurface(surface,new THREE.Vector3(-2,0,.5),new THREE.Vector3(3,.8,.5));
  assert.ok(point.x>=.16&&point.x<=.84,`landing x=${point.x} should include a paw/body margin`);
  assert.ok(point.z>=.16&&point.z<=.84);
});
