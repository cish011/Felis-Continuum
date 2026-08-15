import * as THREE from 'three';
import { clamp, shortestAngle } from '../core/math.js';

const INTERACTION_TIME = Object.freeze({
  eat:7.5, drink:5.2, rest:18, play:11, social:8, groom:9,
  litter:6.5, scratch:7, explore:5, investigate:4.2, observe:10,
});

const STOP_DISTANCE = Object.freeze({
  eat:.34, drink:.32, rest:.48, play:.42, social:.68, litter:.43,
  scratch:.4, explore:.38, investigate:.48, flee:.55,
});

const URGENCY_SPEED = Object.freeze({
  flee:1, play:.78, litter:.62, drink:.54, eat:.5, investigate:.42,
  explore:.34, social:.3, rest:.22, scratch:.35,
});

const vec = (value,fallback=new THREE.Vector3()) => {
  if(value?.isVector3)return value.clone();
  if(value&&Number.isFinite(value.x)&&Number.isFinite(value.z))return new THREE.Vector3(value.x,value.y??0,value.z);
  if(Array.isArray(value))return new THREE.Vector3(value[0]??0,value[1]??0,value[2]??0);
  return fallback.clone();
};
const horizontalDistance=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
const finite=(value,fallback=0)=>Number.isFinite(value)?value:fallback;

/**
 * Converts a persistent cognitive plan into closed-loop physical actions. It
 * deliberately owns no needs or utility logic: cognition says what is wanted;
 * this layer decides how to physically achieve it and reports progress back.
 */
export class GoalExecutor {
  constructor({locomotion,environment,toyPhysics,events}={}) {
    this.locomotion=locomotion;
    this.environment=environment??{};
    this.toyPhysics=toyPhysics??null;
    this.events=events??null;
    this.goal='observe';
    this.planId=null;
    this.targetId=null;
    this.target=null;
    this.navTarget=null;
    this.phase='settle';
    this.phaseTime=0;
    this.interactionTime=0;
    this.progress=0;
    this.goalComplete=false;
    this.goalImpossible=false;
    this.stuckTime=0;
    this.previousPosition=this.locomotion?.position?.clone?.()??new THREE.Vector3();
    this.waypoints=[];
    this.waypointIndex=0;
    this.jumpWasActive=false;
    this.batCooldown=0;
    this.resourceCommitted=false;
    this.lastMotion=this.locomotion?.getMotionState?.()??{position:new THREE.Vector3(),heading:0,velocity:new THREE.Vector3(),speed:0,feet:{}};
    this.interruption=null;
    this.threatTarget=null;
    this.fleeTarget=null;
  }

  update(dt,snapshot) {
    dt=clamp(finite(dt,0),0,.1);
    this.goalComplete=false;
    this.goalImpossible=false;
    this.batCooldown=Math.max(0,this.batCooldown-dt);
    const intention=snapshot?.intention;
    const plan=snapshot?.plan;
    const requestedGoal=intention?.goal??'observe';
    const requestedPlanId=plan?.id??`${requestedGoal}:${plan?.target?.id??'none'}`;
    if(requestedGoal!==this.goal||requestedPlanId!==this.planId) this.beginPlan(requestedGoal,requestedPlanId,plan);
    // The application stops calling the executor while the cat is physically
    // held. Therefore the first update after a pickup is, by definition, the
    // release/resume frame; retaining this interruption would freeze the cat.
    if(this.interruption?.kind==='pickup') {
      this.interruption=null;
      this.phase='settle';
    }
    this.phaseTime+=dt;

    let result;
    if(this.interruption?.kind==='pickup') result=this.holdStill(dt,'social');
    else if(this.goal==='observe') result=this.updateObserve(dt,snapshot);
    else if(this.goal==='groom') result=this.updateGroom(dt,snapshot);
    else if(this.goal==='flee') result=this.updateTargetGoal(dt,snapshot,true);
    else result=this.updateTargetGoal(dt,snapshot,false);

    const movement=this.lastMotion.position.distanceTo(this.previousPosition);
    if((this.lastMotion.speed??0)>.1&&movement<.0003)this.stuckTime+=dt;
    else this.stuckTime=Math.max(0,this.stuckTime-dt*1.5);
    this.previousPosition.copy(this.lastMotion.position);
    if(this.stuckTime>9) {
      this.goalImpossible=true;
      this.locomotion?.clearTarget?.();
      this.stuckTime=0;
    }
    return {
      motion:this.lastMotion,
      activity:result.activity,
      progress:clamp(this.progress),
      distanceToTarget:result.distance,
      facingTarget:result.facing,
      goalComplete:this.goalComplete,
      goalImpossible:this.goalImpossible,
      surface:this.surfaceLabel(),
      interaction:result.interaction??null,
      phase:this.phase,
      targetId:this.targetId,
    };
  }

  beginPlan(goal,planId,plan) {
    this.goal=goal;
    this.planId=planId;
    this.targetId=plan?.target?.id??null;
    this.target=plan?.target?.position?vec(plan.target.position):null;
    this.navTarget=null;
    this.phase='orient';
    this.phaseTime=0;
    this.interactionTime=0;
    this.progress=0;
    this.goalComplete=false;
    this.goalImpossible=false;
    this.resourceCommitted=false;
    this.waypointIndex=0;
    this.waypoints=this.target?this.buildTraversalWaypoints(this.locomotion.position,this.target):[];
    this.locomotion?.clearTarget?.();
    this.interruption=null;
    this.threatTarget=null;
    this.fleeTarget=null;
  }

  updateObserve(dt,snapshot) {
    this.locomotion.clearTarget();
    const attention=snapshot?.perception?.attention?.position;
    let desiredHeading=this.locomotion.heading;
    if(attention) {
      const target=vec(attention);
      desiredHeading=Math.atan2(target.x-this.locomotion.position.x,target.z-this.locomotion.position.z);
    } else desiredHeading+=Math.sin(this.phaseTime*.37)*.002;
    this.lastMotion=this.locomotion.update(dt,{desiredHeading,desiredSpeed:0});
    this.phase='observe';
    this.interactionTime+=dt;
    this.progress=this.interactionTime/INTERACTION_TIME.observe;
    if(this.progress>=1)this.goalComplete=true;
    return {activity:'observe',distance:Infinity,facing:1,interaction:{kind:'scan',attention:snapshot?.perception?.attention?.id??null}};
  }

  updateGroom(dt,snapshot) {
    this.locomotion.clearTarget();
    this.lastMotion=this.locomotion.update(dt,{desiredHeading:this.locomotion.heading,desiredSpeed:0,crouch:true});
    if(this.lastMotion.speed<.08) {
      this.phase='interact';
      this.interactionTime+=dt;
      this.progress=this.interactionTime/INTERACTION_TIME.groom;
    }
    if(this.progress>=1)this.goalComplete=true;
    return {activity:this.lastMotion.speed<.08?'groom':'locomote',distance:0,facing:1,interaction:{kind:'groom',region:this.groomRegion(snapshot)}};
  }

  updateTargetGoal(dt,snapshot,flee) {
    const dynamic=this.resolveDynamicTarget(snapshot);
    if(flee&&this.targetId!=='temporary-safety') {
      const threat=dynamic??this.threatTarget??this.target;
      if(threat) {
        if(!this.threatTarget||!this.fleeTarget||horizontalDistance(threat,this.threatTarget)>.35) {
          this.threatTarget=threat.clone();
          this.fleeTarget=this.computeFleeTarget(threat);
        }
        this.target=this.fleeTarget.clone();
      }
    } else if(dynamic)this.target=dynamic;
    if(!this.target) {
      this.lastMotion=this.locomotion.update(dt,{desiredSpeed:0});
      this.progress=Math.min(.28,this.progress+dt*.015);
      if(this.phaseTime>5)this.goalImpossible=true;
      return {activity:'search',distance:Infinity,facing:0,interaction:null};
    }

    const current=this.locomotion.position;
    const distance=horizontalDistance(current,this.target);
    const vertical=this.target.y-current.y;
    const stopping=STOP_DISTANCE[this.goal]??.4;

    if(this.locomotion.jumpPhase&&this.locomotion.jumpPhase!=='none') {
      this.jumpWasActive=true;
      this.lastMotion=this.locomotion.update(dt,{gait:this.goal==='play'?'run':'walk'});
      this.phase=`jump-${this.locomotion.jumpPhase}`;
      this.progress=Math.max(this.progress,.35);
      return {activity:'locomote',distance,facing:this.facing(this.target),interaction:{kind:'jump',phase:this.locomotion.jumpPhase,target:this.target}};
    }
    if(this.jumpWasActive) {
      this.jumpWasActive=false;
      if(horizontalDistance(this.locomotion.position,this.currentWaypoint())<.75)this.advanceWaypoint();
    }

    const waypoint=this.currentWaypoint();
    const waypointDistance=horizontalDistance(current,waypoint);
    const waypointVertical=waypoint.y-current.y;
    if(Math.abs(waypointVertical)>.24) {
      const traversal=this.updateTraversal(dt,waypoint,waypointDistance,waypointVertical);
      if(traversal)return traversal;
    } else if(this.waypointIndex<this.waypoints.length-1&&waypointDistance<.42) {
      this.advanceWaypoint();
    }

    const finalDistance=horizontalDistance(this.locomotion.position,this.target);
    if(finalDistance>stopping*1.12) {
      this.phase=this.goal==='play'&&finalDistance<2.2?'stalk':'approach';
      const options=this.navigationOptions(finalDistance);
      const destination=this.goal==='play'?this.predictToyIntercept(this.target):this.target;
      this.ensureNavigationTarget(destination,options);
      this.lastMotion=this.locomotion.update(dt,{stalk:this.phase==='stalk'});
      this.progress=Math.max(this.progress,clamp(1-finalDistance/12)*.7);
      return {activity:'locomote',distance:finalDistance,facing:this.facing(this.target),interaction:null};
    }

    this.locomotion.clearTarget();
    const desiredHeading=Math.atan2(this.target.x-current.x,this.target.z-current.z);
    this.lastMotion=this.locomotion.update(dt,{desiredHeading,desiredSpeed:0,crouch:this.goal==='play'||this.goal==='litter'});
    const facing=this.facing(this.target);
    if(facing<.64||this.lastMotion.speed>.12) {
      this.phase='position';
      this.progress=Math.max(this.progress,.72);
      return {activity:'locomote',distance:finalDistance,facing,interaction:{kind:'position',goal:this.goal}};
    }

    return this.performInteraction(dt,snapshot,finalDistance,facing);
  }

  updateTraversal(dt,landing,distance,vertical) {
    const direction=landing.clone().sub(this.locomotion.position); direction.y=0;
    if(direction.lengthSq()>.0001)direction.normalize(); else direction.set(0,0,1);
    const idealLaunch=landing.clone().addScaledVector(direction,-clamp(.58+Math.abs(vertical)*.28,.58,1.05));
    const launchSurface=this.sampleSurface(idealLaunch,this.locomotion.position.y,.3);
    idealLaunch.y=launchSurface.height;
    const launchDistance=horizontalDistance(this.locomotion.position,idealLaunch);
    if(launchDistance>.22) {
      this.phase='approach-launch';
      this.ensureNavigationTarget(idealLaunch,{urgency:.36,maxSpeed:1.1,stoppingDistance:.16,maxStep:.26});
      this.lastMotion=this.locomotion.update(dt,{});
      this.progress=Math.max(this.progress,.18);
      return {activity:'locomote',distance:distance,facing:this.facing(landing),interaction:{kind:'prepare-jump',landing}};
    }
    this.locomotion.clearTarget();
    const launched=this.locomotion.launchJump({
      position:landing,preserveTargetHeight:true,maxDistance:3.2,
      anticipationDuration:vertical>.5?.22:.15,
      compressionDuration:vertical<-.4?.26:.19,
    });
    if(launched) {
      this.phase='jump-anticipation';this.jumpWasActive=true;
      this.lastMotion=this.locomotion.update(dt,{});
      return {activity:'locomote',distance,facing:1,interaction:{kind:'jump',phase:'anticipation',landing}};
    }
    this.goalImpossible=true;
    this.lastMotion=this.locomotion.update(dt,{desiredSpeed:0});
    return {activity:'locomote',distance,facing:0,interaction:null};
  }

  performInteraction(dt,snapshot,distance,facing) {
    this.phase='interact';
    this.interactionTime+=dt;
    const duration=INTERACTION_TIME[this.goal]??5;
    this.progress=.74+clamp(this.interactionTime/duration)*.26;
    const activity=this.goal;
    let detail={kind:this.goal,targetId:this.targetId};
    if(this.goal==='eat') {
      const resource=this.environment.resources?.food;
      if(resource)resource.fullness=Math.max(0,resource.fullness-dt*.022);
      if(resource?.fullness<=.005)this.goalComplete=true;
    } else if(this.goal==='drink') {
      const resource=this.environment.resources?.water;
      if(resource)resource.fullness=Math.max(0,resource.fullness-dt*.016);
      if(resource?.fullness<=.005)this.goalComplete=true;
    } else if(this.goal==='litter'&&this.interactionTime>=duration&&!this.resourceCommitted) {
      const resource=this.environment.resources?.litter;
      if(resource)resource.cleanliness=Math.max(0,resource.cleanliness-.18);
      this.resourceCommitted=true;
    } else if(this.goal==='play') {
      detail=this.performPlay(dt,detail);
    } else if(this.goal==='scratch') {
      detail={...detail,reach:clamp(.4+Math.sin(this.interactionTime*10)*.35)};
    } else if(this.goal==='rest') {
      detail={...detail,pose:this.interactionTime>4?'loaf':'settling'};
    }
    if(this.interactionTime>=duration)this.goalComplete=true;
    return {activity,distance,facing,interaction:detail};
  }

  performPlay(dt,detail) {
    const body=this.findToy(this.targetId);
    if(!body)return detail;
    const distance=horizontalDistance(this.locomotion.position,body.position);
    if(distance<.52&&this.batCooldown<=0) {
      const impulse=body.position.clone().sub(this.locomotion.position);impulse.y=0;
      if(impulse.lengthSq()<.01)impulse.set(Math.sin(this.locomotion.heading),0,Math.cos(this.locomotion.heading));
      impulse.normalize().multiplyScalar(.038).add(new THREE.Vector3(0,.014,0));
      this.toyPhysics?.batImpulse?.(body,impulse,body.position.clone().add(new THREE.Vector3(0,.03,0)));
      this.batCooldown=.55+Math.random()*.42;
      return {...detail,kind:'bat',toyId:body.id,paw:this.interactionTime%1.2<.6?'frontLeft':'frontRight'};
    }
    return {...detail,kind:'track-toy',toyId:body.id};
  }

  holdStill(dt,activity='observe') {
    this.locomotion.clearTarget();
    this.lastMotion=this.locomotion.update(dt,{desiredSpeed:0});
    return {activity,distance:0,facing:1,interaction:{kind:this.interruption.kind}};
  }

  resolveDynamicTarget(snapshot) {
    if(this.goal==='play') {
      const body=this.findToy(this.targetId);
      // Keep the semantic target at the actual toy. The navigation destination
      // is predicted exactly once below; predicting here as well double-led a
      // moving toy and made the cat chase empty space.
      if(body)return body.position.clone();
    }
    const planTarget=snapshot?.plan?.target;
    if(planTarget?.position)return vec(planTarget.position);
    if(this.goal==='flee'&&this.threatTarget)return this.threatTarget.clone();
    return this.target;
  }

  predictToyIntercept(position,velocity) {
    const p=vec(position),v=vec(velocity);
    if(!velocity&&this.goal==='play') {
      const body=this.findToy(this.targetId);if(body)v.copy(body.velocity);
    }
    const distance=horizontalDistance(this.locomotion.position,p);
    const horizon=clamp(distance/Math.max(.5,(this.locomotion.speed??0)+.8),.12,.75);
    return p.addScaledVector(v,horizon);
  }

  computeFleeTarget(threat) {
    const away=this.locomotion.position.clone().sub(threat);away.y=0;
    if(away.lengthSq()<.01)away.set(-Math.sin(this.locomotion.heading),0,-Math.cos(this.locomotion.heading));
    away.normalize();
    const target=this.locomotion.position.clone().addScaledVector(away,5);
    const surface=this.sampleSurface(target,this.locomotion.position.y,.3);target.y=surface.height;
    return target;
  }

  navigationOptions(distance) {
    const urgency=URGENCY_SPEED[this.goal]??.4;
    return {
      urgency,
      maxSpeed:this.goal==='flee'?3.7:this.goal==='play'&&distance<2.5?2.1:undefined,
      stoppingDistance:STOP_DISTANCE[this.goal]??.4,
      stalk:this.goal==='play'&&distance<2.2,
      repathInterval:this.goal==='play'?.28:.7,
      clearOnArrival:false,
    };
  }

  ensureNavigationTarget(target,options) {
    if(!this.navTarget||this.navTarget.distanceTo(target)>.22||!this.locomotion.target) {
      this.navTarget=target.clone();
      this.locomotion.setTarget(target,options);
    }
  }

  buildTraversalWaypoints(start,target) {
    const waypoints=[];
    let cursor=vec(start),guard=0;
    const ascending=target.y>cursor.y+.24;
    const descending=target.y<cursor.y-.24;
    if(!ascending&&!descending)return [target.clone()];
    while(guard++<8&&Math.abs(target.y-cursor.y)>.72) {
      const candidate=this.bestIntermediateSurface(cursor,target,ascending);
      if(!candidate)break;
      waypoints.push(candidate);cursor=candidate;
    }
    waypoints.push(target.clone());
    return waypoints;
  }

  bestIntermediateSurface(cursor,target,ascending) {
    let best=null,bestScore=Infinity;
    for(const surface of this.environment.surfaces??[]) {
      if(surface.walkable===false)continue;
      const y=finite(surface.y,0);
      const delta=y-cursor.y;
      if(ascending&&(delta<.18||delta>1.45||y>target.y+.15))continue;
      if(!ascending&&(delta>-.18||delta< -2.2||y<target.y-.15))continue;
      const point=this.closestPointOnSurface(surface,cursor,target);
      const travel=horizontalDistance(cursor,point);
      if(travel>2.65)continue;
      const remaining=horizontalDistance(point,target)+Math.abs(target.y-y)*.45;
      const gain=Math.abs(delta);
      const score=travel*.45+remaining-gain*.35;
      if(score<bestScore){best=point;bestScore=score;}
    }
    return best;
  }

  closestPointOnSurface(surface,cursor,target) {
    const margin=.16;
    const rawMinX=finite(surface.minX,target.x),rawMaxX=finite(surface.maxX,target.x);
    const rawMinZ=finite(surface.minZ,target.z),rawMaxZ=finite(surface.maxZ,target.z);
    let minX=Math.min(rawMinX,rawMaxX)+margin,maxX=Math.max(rawMinX,rawMaxX)-margin;
    let minZ=Math.min(rawMinZ,rawMaxZ)+margin,maxZ=Math.max(rawMinZ,rawMaxZ)-margin;
    if(minX>maxX) minX=maxX=(rawMinX+rawMaxX)*.5;
    if(minZ>maxZ) minZ=maxZ=(rawMinZ+rawMaxZ)*.5;
    const blend=cursor.clone().lerp(target,.62);
    const x=clamp(blend.x,minX,maxX);
    const z=clamp(blend.z,minZ,maxZ);
    const y=typeof surface.heightAt==='function'?surface.heightAt(x,z):finite(surface.y,target.y);
    return new THREE.Vector3(x,y,z);
  }

  currentWaypoint(){return this.waypoints[this.waypointIndex]??this.target;}
  advanceWaypoint(){this.waypointIndex=Math.min(this.waypointIndex+1,Math.max(0,this.waypoints.length-1));this.navTarget=null;}

  sampleSurface(point,referenceY=Infinity,maxStep=Infinity) {
    const raw=this.environment.sampleSurface?.(point.x,point.z,{referenceY,maxStep});
    if(Number.isFinite(raw))return {height:raw,normal:new THREE.Vector3(0,1,0),type:'floor'};
    return {height:raw?.height??raw?.y??point.y??0,normal:vec(raw?.normal,new THREE.Vector3(0,1,0)),type:raw?.type??raw?.surface?.type??'floor'};
  }

  surfaceLabel() {return this.sampleSurface(this.locomotion.position,this.locomotion.position.y,.4).type;}
  facing(target) {
    const heading=Math.atan2(target.x-this.locomotion.position.x,target.z-this.locomotion.position.z);
    return clamp((Math.cos(shortestAngle(this.locomotion.heading,heading))+1)*.5);
  }
  findToy(id){return this.toyPhysics?.toys?.find(body=>body.id===id)??null;}
  groomRegion(snapshot) {
    const cleanliness=snapshot?.needs?.cleanliness??.7;
    const sequence=['chest','foreleg','shoulder','flank','hindleg','tail-base'];
    return sequence[Math.floor((this.interactionTime*(cleanliness<.5?1.25:.72))%sequence.length)];
  }

  getPath() {
    const path=this.locomotion?.getPath?.()??[];
    if(this.waypoints.length>this.waypointIndex)return [...path,...this.waypoints.slice(this.waypointIndex).map(point=>point.clone())];
    return path;
  }

  interrupt(kind,data={}) {
    this.interruption={kind,data};
    this.locomotion?.clearTarget?.();
    if(kind!=='pickup')this.phase='interrupted';
  }

  dispose(){this.locomotion?.clearTarget?.();this.waypoints.length=0;this.interruption=null;}
}

export default GoalExecutor;
