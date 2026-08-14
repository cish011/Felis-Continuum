import * as THREE from 'three';

/**
 * Procedurally constructs the complete Felis Continuum habitat.
 *
 * World convention: one unit is one metre, +Y is up, and the house spans
 * roughly 26 x 20 metres.  Public records deliberately use plain objects and
 * Three.js vectors so locomotion, planning, audio and debug views can consume
 * the same data without depending on the scene graph layout.
 *
 * @param {THREE.Scene|THREE.Group} scene Scene that will own the habitat root.
 * @returns {{
 *   root: THREE.Group,
 *   obstacles: Array,
 *   surfaces: Array,
 *   interestPoints: Array,
 *   interactables: Array,
 *   sampleSurface: Function,
 *   roomAt: Function,
 *   toggleDoor: Function,
 *   refill: Function,
 *   cleanLitter: Function,
 *   update: Function,
 *   getPerceptionObjects: Function,
 *   dispose: Function
 * }}
 */
export function createEnvironment(scene) {
  const root = new THREE.Group();
  root.name = 'Felis Continuum Habitat';
  scene.add(root);

  const obstacles = [];
  const surfaces = [];
  const interestPoints = [];
  const interactables = [];
  const animated = [];
  const doors = new Map();
  const resources = Object.create(null);
  const disposableTextures = new Set();
  const tmpBox = new THREE.Box3();
  const tmpNormal = new THREE.Vector3();

  const palette = {
    plaster: material(0xd8d0c2, .92, 0),
    plasterWarm: material(0xc9baa8, .93, 0),
    trim: material(0xf0e9dc, .76, 0),
    darkTrim: material(0x3a3732, .78, .03),
    wood: material(0x886447, .72, .03),
    lightWood: material(0xb38a61, .75, .02),
    darkWood: material(0x49382d, .67, .03),
    floorWood: material(0x9b795b, .84, .01),
    tile: material(0xc9c7bf, .55, .02),
    tileDark: material(0x767b7b, .62, .02),
    carpet: material(0x7d756d, 1, 0),
    fabricGreen: material(0x5e7568, .98, 0),
    fabricBlue: material(0x546c7d, .96, 0),
    fabricCream: material(0xd8c8ae, 1, 0),
    fabricRust: material(0xa85f46, .98, 0),
    cardboard: material(0xa97945, .94, 0),
    rope: material(0xb9a078, 1, 0),
    steel: material(0x8f9899, .3, .72),
    blackMetal: material(0x252a2b, .28, .7),
    ceramic: material(0xe5e3dc, .2, .12),
    porcelain: material(0xeeeae1, .16, .05),
    glass: material(0x7ca7af, .08, .1, { transparent:true, opacity:.27, side:THREE.DoubleSide }),
    windowDark: material(0x34505a, .18, .12, { transparent:true, opacity:.68, emissive:0x132a31, emissiveIntensity:.4 }),
    water: material(0x4eaac5, .12, .05, { transparent:true, opacity:.72, emissive:0x0c3d4a, emissiveIntensity:.24 }),
    food: material(0x765035, .88, 0),
    litter: material(0xb9af98, 1, 0),
    soil: material(0x4b382a, 1, 0),
    lawn: material(0x4d7044, 1, 0),
    leaf: material(0x41643d, .93, 0),
    leafLight: material(0x678358, .95, 0),
    flower: material(0xb9828f, .8, 0),
    stone: material(0x777a73, .95, 0),
    concrete: material(0xaaa69b, .94, 0),
    rubber: material(0x313331, .9, 0),
    screen: material(0x10181d, .19, .18, { emissive:0x132430, emissiveIntensity:.32 }),
    warmGlow: material(0xffdb9c, .28, 0, { emissive:0xffb85f, emissiveIntensity:1.7 }),
    white: material(0xf2eee4, .7, .01),
    red: material(0xa44b3e, .78, .02),
    blue: material(0x3e647d, .72, .05),
    yellow: material(0xd0a94a, .74, .02),
  };

  const roomZones = [
    zone('living-room', 'Living room', -12.9, -.65, -9.9, 1.85),
    zone('kitchen', 'Kitchen', .65, 12.9, -9.9, 1.85),
    zone('bedroom', 'Bedroom', -12.9, -.65, 2.15, 9.9),
    zone('bathroom', 'Bathroom', .65, 6.1, 2.15, 9.9),
    zone('hall-stairs', 'Hall and stairs', 6.1, 12.9, 1.85, 9.9),
    zone('garden', 'Enclosed garden', -12.9, 12.9, -20, -10.05),
  ];

  function material(color, roughness=.8, metalness=0, extra={}) {
    return new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
  }

  function zone(id, label, minX, maxX, minZ, maxZ) {
    return { id, label, minX, maxX, minZ, maxZ };
  }

  function boxMesh(name, position, size, mat, parent=root, cast=true, receive=true) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), mat);
    mesh.name = name;
    mesh.position.set(position[0], position[1], position[2]);
    mesh.castShadow = cast;
    mesh.receiveShadow = receive;
    parent.add(mesh);
    return mesh;
  }

  function cylinderMesh(name, position, radiusTop, radiusBottom, height, mat, segments=20, parent=root) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radiusTop, radiusBottom, height, segments), mat);
    mesh.name = name;
    mesh.position.set(position[0], position[1], position[2]);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  function sphereMesh(name, position, radius, mat, scale=[1,1,1], parent=root, segments=18) {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, segments, Math.max(10, Math.floor(segments * .66))), mat);
    mesh.name = name;
    mesh.position.set(position[0], position[1], position[2]);
    mesh.scale.set(scale[0], scale[1], scale[2]);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  function registerObstacle(id, object, room, type='furniture', options={}) {
    object.updateWorldMatrix(true, true);
    const bounds = new THREE.Box3().setFromObject(object);
    const entry = {
      id,
      type,
      room,
      object,
      min: bounds.min.clone(),
      max: bounds.max.clone(),
      enabled: options.enabled !== false,
      dynamic: Boolean(options.dynamic),
      permeability: options.permeability ?? 0,
      tags: options.tags ? [...options.tags] : [],
    };
    object.userData.obstacleId = id;
    obstacles.push(entry);
    return entry;
  }

  function obstacleBox(id, room, position, size, mat, type='furniture', options={}) {
    const mesh = boxMesh(id, position, size, mat, options.parent || root, options.cast !== false, options.receive !== false);
    const obstacle = registerObstacle(id, mesh, room, type, options);
    if (options.surface) {
      addSurface({
        id:`${id}-top`, room, type:options.surfaceType || type,
        minX:position[0] - size[0] / 2, maxX:position[0] + size[0] / 2,
        minZ:position[2] - size[2] / 2, maxZ:position[2] + size[2] / 2,
        y:position[1] + size[1] / 2,
        softness:options.softness || 0,
        friction:options.friction ?? .8,
        climbable:options.climbable !== false,
        object:mesh,
      });
    }
    return { mesh, obstacle };
  }

  function addSurface(spec) {
    const normal = spec.normal ? spec.normal.clone().normalize() : new THREE.Vector3(0, 1, 0);
    const record = {
      id: spec.id,
      room: spec.room,
      type: spec.type || 'floor',
      minX: spec.minX,
      maxX: spec.maxX,
      minZ: spec.minZ,
      maxZ: spec.maxZ,
      y: spec.y || 0,
      normal,
      walkable: spec.walkable !== false,
      climbable: spec.climbable !== false,
      softness: spec.softness || 0,
      friction: spec.friction ?? .78,
      priority: spec.priority || 0,
      heightAt: spec.heightAt || null,
      object: spec.object || null,
      tags: spec.tags ? [...spec.tags] : [],
    };
    surfaces.push(record);
    return record;
  }

  function addInterest(id, type, label, position, room, options={}) {
    const point = {
      id, type, label, room,
      position: position.isVector3 ? position : new THREE.Vector3(...position),
      radius: options.radius ?? .7,
      utility: options.utility ?? .5,
      heightPreference: options.heightPreference ?? 0,
      available: options.available !== false,
      tags: options.tags ? [...options.tags] : [],
      object: options.object || null,
      state: options.state || null,
    };
    interestPoints.push(point);
    return point;
  }

  function addInteractable(id, kind, label, object, room, position, action, state={}) {
    const actionId=state.action || (kind==='door'?`toggle-door:${id}`:kind==='food'||kind==='water'?`refill:${kind}`:kind==='litter'?'clean-litter':`interact:${id}`);
    const record = {
      id, kind, label, object, room,
      position: position.isVector3 ? position : new THREE.Vector3(...position),
      radius: state.radius || .75,
      action,
      state,
      enabled: true,
    };
    if (object) {
      object.userData.interactableId = id;
      object.userData.interaction = {type:kind,label,action:actionId};
      object.traverse?.(child=>{
        if(child.isMesh || child.isLine) child.userData.interaction={type:kind,label,action:actionId,interactableId:id};
      });
    }
    interactables.push(record);
    return record;
  }

  function addFloor(id, room, minX, maxX, minZ, maxZ, mat, y=0) {
    const mesh = boxMesh(id, [(minX + maxX)/2, y-.08, (minZ + maxZ)/2], [maxX-minX, .16, maxZ-minZ], mat, root, false, true);
    addSurface({ id:`${id}-surface`, room, type:'floor', minX, maxX, minZ, maxZ, y, object:mesh, climbable:true, friction:.87, priority:-10 });
    return mesh;
  }

  function addWall(id, room, position, size, mat=palette.plaster) {
    const wall = obstacleBox(id, room, position, size, mat, 'wall', { cast:true, receive:true });
    if (size[1] > 1) {
      const baseY = position[1] - size[1]/2 + .07;
      if (size[0] > size[2]) boxMesh(`${id}-baseboard`, [position[0], baseY, position[2] + Math.sign(position[2] || 1) * .105], [size[0], .14, .055], palette.trim, root, false, true);
      else boxMesh(`${id}-baseboard`, [position[0] + Math.sign(position[0] || 1) * .105, baseY, position[2]], [.055, .14, size[2]], palette.trim, root, false, true);
    }
    return wall.mesh;
  }

  // -------------------------------------------------------------------------
  // Architectural shell: continuous floors, room openings, windows and doors.
  // -------------------------------------------------------------------------

  addFloor('living-floor', 'living-room', -12.9, -.65, -9.9, 1.85, palette.floorWood);
  addFloor('kitchen-floor', 'kitchen', .65, 12.9, -9.9, 1.85, palette.tile);
  addFloor('bedroom-floor', 'bedroom', -12.9, -.65, 2.15, 9.9, palette.lightWood);
  addFloor('bath-floor', 'bathroom', .65, 6.1, 2.15, 9.9, palette.tileDark);
  addFloor('hall-floor', 'hall-stairs', 6.1, 12.9, 1.85, 9.9, palette.floorWood);
  addFloor('north-threshold-floor', 'hall-stairs', -.65, 6.1, 1.85, 2.15, palette.floorWood);
  addFloor('central-threshold-floor', 'hall-stairs', -.65, .65, -9.9, 9.9, palette.floorWood);
  addFloor('garden-lawn', 'garden', -12.9, 12.9, -19.9, -10.05, palette.lawn, -.015);

  // Fine floor-board seams make scale and direction readable without textures.
  for (let z=-9.5; z<1.8; z+=.48) boxMesh(`living-board-seam-${z}`, [-6.78, .006, z], [12.1, .008, .014], palette.darkWood, root, false, true);
  for (let z=2.35; z<9.8; z+=.52) boxMesh(`bedroom-board-seam-${z}`, [-6.78, .006, z], [12.1, .008, .012], palette.darkWood, root, false, true);
  for (let x=.9; x<12.8; x+=.72) boxMesh(`kitchen-grout-x-${x}`, [x, .006, -4.02], [.016, .008, 11.7], palette.tileDark, root, false, true);
  for (let z=-9.6; z<1.8; z+=.72) boxMesh(`kitchen-grout-z-${z}`, [6.78, .006, z], [12.1, .008, .016], palette.tileDark, root, false, true);

  // Outer shell, with a broad glazed garden doorway at the south side.
  addWall('west-wall', 'living-room', [-13, 1.58, 0], [.2, 3.16, 20], palette.plasterWarm);
  addWall('east-wall', 'hall-stairs', [13, 1.58, 0], [.2, 3.16, 20], palette.plaster);
  addWall('north-wall', 'bedroom', [0, 1.58, 10], [26, 3.16, .2], palette.plasterWarm);
  addWall('south-wall-west', 'living-room', [-3.65, 1.58, -10], [18.7, 3.16, .2], palette.plaster);
  addWall('south-wall-east', 'kitchen', [10.85, 1.58, -10], [4.3, 3.16, .2], palette.plaster);
  addWall('garden-door-lintel', 'kitchen', [7.25, 2.82, -10], [3, .68, .2], palette.trim);

  // Internal walls are split around real passage widths rather than painted-on doors.
  addWall('living-kitchen-wall-a', 'living-room', [0, 1.58, -6.15], [.18, 3.16, 7.5]);
  addWall('living-kitchen-wall-b', 'living-room', [0, 1.58, 1.05], [.18, 3.16, 1.6]);
  addWall('north-partition-west', 'bedroom', [-8.75, 1.58, 2], [8.5, 3.16, .18]);
  addWall('north-partition-mid', 'bedroom', [-.15, 1.58, 2], [4.7, 3.16, .18]);
  addWall('north-partition-east', 'hall-stairs', [8.6, 1.58, 2], [8.8, 3.16, .18]);
  addWall('bed-bath-wall-a', 'bedroom', [0, 1.58, 3.25], [.18, 3.16, 2.5]);
  addWall('bed-bath-wall-b', 'bedroom', [0, 1.58, 8.25], [.18, 3.16, 3.5]);
  addWall('bath-hall-wall-a', 'bathroom', [6.2, 1.58, 3.25], [.18, 3.16, 2.5]);
  addWall('bath-hall-wall-b', 'bathroom', [6.2, 1.58, 7.85], [.18, 3.16, 4.3]);

  addWindow('living-west-window', [-12.88, 1.68, -4.8], 'x', 2.5, 1.45, 'living-room');
  addWindow('bedroom-west-window', [-12.88, 1.68, 6.1], 'x', 2.15, 1.35, 'bedroom');
  addWindow('bedroom-north-window', [-7.6, 1.68, 9.88], 'z', 2.7, 1.4, 'bedroom');
  addWindow('bathroom-north-window', [3.15, 1.86, 9.88], 'z', 1.55, .94, 'bathroom', true);
  addWindow('kitchen-east-window', [12.88, 1.72, -3.5], 'x', 2.35, 1.35, 'kitchen');

  function addWindow(id, position, axis, width, height, room, frosted=false) {
    const group = new THREE.Group();
    group.name = id;
    group.position.set(...position);
    root.add(group);
    const glassMat = frosted ? material(0xb9d0d1, .62, 0, {transparent:true, opacity:.7}) : palette.windowDark;
    const glassSize = axis === 'z' ? [width, height, .025] : [.025, height, width];
    boxMesh(`${id}-glass`, [0,0,0], glassSize, glassMat, group, false, true);
    const horizontal = axis === 'z';
    const railSize = horizontal ? [width+.16,.065,.07] : [.07,.065,width+.16];
    boxMesh(`${id}-top`, [0,height/2+.055,0], railSize, palette.trim, group, false, true);
    boxMesh(`${id}-bottom`, [0,-height/2-.055,0], railSize, palette.trim, group, false, true);
    const sideSize = horizontal ? [.07,height+.18,.07] : [.07,height+.18,.07];
    if (horizontal) {
      boxMesh(`${id}-left`, [-width/2-.055,0,0], sideSize, palette.trim, group, false, true);
      boxMesh(`${id}-right`, [width/2+.055,0,0], sideSize, palette.trim, group, false, true);
      boxMesh(`${id}-mullion`, [0,0,.018], [.045,height,.055], palette.trim, group, false, true);
    } else {
      boxMesh(`${id}-left`, [0,0,-width/2-.055], sideSize, palette.trim, group, false, true);
      boxMesh(`${id}-right`, [0,0,width/2+.055], sideSize, palette.trim, group, false, true);
      boxMesh(`${id}-mullion`, [.018,0,0], [.055,height,.045], palette.trim, group, false, true);
    }
    const ledgePosition = horizontal
      ? [position[0], position[1]-height/2-.12, position[2]-(position[2] > 0 ? .16 : -.16)]
      : [position[0]-(position[0] > 0 ? .16 : -.16), position[1]-height/2-.12, position[2]];
    const ledgeSize = horizontal ? [width+.34,.12,.42] : [.42,.12,width+.34];
    const ledge = obstacleBox(`${id}-ledge`, room, ledgePosition, ledgeSize, palette.trim, 'window-ledge', {surface:true, softness:.05});
    addInterest(`${id}-watch`, 'watch', 'Watch light and movement beyond the glass', [ledgePosition[0], ledgePosition[1]+.16, ledgePosition[2]], room, {radius:.9, utility:.72, heightPreference:.8, object:ledge.mesh, tags:['lookout','sunlight','elevated']});
  }

  addDoor('garden-door', 'Garden door', 'kitchen', [5.78, 0, -9.88], 2.75, 1.38, 'x', 1);
  addDoor('bathroom-door', 'Bathroom door', 'bathroom', [6.1, 0, 4.5], 2.35, 1.16, 'z', -1);
  addDoor('bedroom-door', 'Bedroom door', 'bedroom', [-4.48, 0, 2.1], 2.35, 1.92, 'x', 1);

  function addDoor(id, label, room, hinge, height, width, axis='x', direction=1) {
    const pivot = new THREE.Group();
    pivot.name = `${id}-hinge`;
    pivot.position.set(...hinge);
    root.add(pivot);
    const panel = boxMesh(`${id}-panel`, [width/2, height/2+.015, 0], [width, height, .07], axis === 'x' && id === 'garden-door' ? palette.glass : palette.lightWood, pivot, true, true);
    boxMesh(`${id}-lower-rail`, [width/2, .25, .041], [width-.1, .11, .025], palette.darkTrim, pivot, false, true);
    const knob = sphereMesh(`${id}-knob`, [width-.16, height*.52, .075], .055, palette.steel, [1,1,1], pivot, 12);
    if (axis === 'z') pivot.rotation.y = Math.PI/2;
    const closedRotation = pivot.rotation.y;
    pivot.updateWorldMatrix(true, true);
    const obstacle = registerObstacle(`${id}-obstacle`, pivot, room, 'door', {dynamic:true, tags:['door']});
    const state = { id, label, room, pivot, panel, knob, obstacle, open:false, amount:0, target:0, closedRotation, direction };
    doors.set(id, state);
    const interactable = addInteractable(id, 'door', label, pivot, room, new THREE.Vector3(...hinge), () => toggleDoor(id), {open:false, radius:1.05});
    state.interactable = interactable;
    addInterest(`${id}-threshold`, 'threshold', `${label} threshold`, [hinge[0] + (axis === 'x' ? width*.5 : 0), .02, hinge[2] + (axis === 'z' ? width*.5 : 0)], room, {radius:1.1, utility:.35, tags:['doorway','scent-boundary']});
  }

  // -------------------------------------------------------------------------
  // Living room: varied resting heights, concealment, climbing and play routes.
  // -------------------------------------------------------------------------

  const rug = boxMesh('living-rug', [-6.8,.018,-4.1], [5.9,.035,3.85], palette.fabricRust, root, false, true);
  for (let x=-9.45; x<-4.1; x+=.34) boxMesh(`rug-stripe-${x}`, [x,.039,-4.1], [.035,.008,3.72], x % .68 < .3 ? palette.fabricCream : palette.darkWood, root, false, true);
  addSurface({id:'living-rug-surface',room:'living-room',type:'rug',minX:-9.75,maxX:-3.85,minZ:-6.03,maxZ:-2.17,y:.04,object:rug,softness:.88,friction:1.05,tags:['soft','warm']});
  addInterest('rug-sun-patch','rest','Warm shifting patch on the rug',[-7.7,.05,-3.35],'living-room',{radius:1.2,utility:.64,tags:['sunlight','soft','ground']});

  addSofa();
  function addSofa() {
    const sofa = new THREE.Group();
    sofa.name = 'living-sofa';
    sofa.position.set(-9.6,0,-.45);
    root.add(sofa);
    boxMesh('sofa-plinth',[0,.22,0],[4.1,.38,1.12],palette.darkWood,sofa,true,true);
    const seat = boxMesh('sofa-seat',[0,.49,-.04],[3.72,.28,1.04],palette.fabricGreen,sofa,true,true);
    boxMesh('sofa-back',[0,.92,.45],[4.08,1.08,.3],palette.fabricGreen,sofa,true,true);
    boxMesh('sofa-left-arm',[-2.0,.62,0],[.34,.82,1.25],palette.fabricGreen,sofa,true,true);
    boxMesh('sofa-right-arm',[2.0,.62,0],[.34,.82,1.25],palette.fabricGreen,sofa,true,true);
    for (const x of [-1.22,0,1.22]) {
      const cushion = boxMesh(`sofa-cushion-${x}`,[x,.67,.22],[1.08,.67,.24],palette.fabricCream,sofa,true,true);
      cushion.rotation.x = -.15;
    }
    sofa.updateWorldMatrix(true,true);
    registerObstacle('living-sofa-obstacle',sofa,'living-room','sofa');
    addSurface({id:'sofa-seat-surface',room:'living-room',type:'sofa',minX:-11.45,maxX:-7.75,minZ:-1.0,maxZ:.06,y:.64,object:seat,softness:.94,friction:1.1,tags:['soft','rest','social']});
    addInterest('sofa-nap','rest','Deep sofa cushion',[-10.15,.67,-.45],'living-room',{radius:1.25,utility:.88,heightPreference:.35,object:seat,tags:['soft','warm','social']});
    addInterest('sofa-back-perch','perch','Narrow sofa-back lookout',[-9.6,1.48,0],'living-room',{radius:.7,utility:.68,heightPreference:.7,object:sofa,tags:['elevated','balance']});
  }

  const coffeeTop = obstacleBox('coffee-table-top','living-room',[-6.55,.52,-3.8],[2.65,.12,1.42],palette.lightWood,'table',{surface:true,friction:.74});
  for (const x of [-7.65,-5.45]) for (const z of [-4.31,-3.29]) obstacleBox(`coffee-leg-${x}-${z}`,'living-room',[x,.26,z],[.12,.52,.12],palette.blackMetal,'table-leg');
  addInterest('coffee-table-inspect','investigate','Objects and scents on the low table',[-6.55,.61,-3.8],'living-room',{radius:.85,utility:.5,heightPreference:.35,object:coffeeTop.mesh,tags:['elevated','object-clutter']});
  cylinderMesh('coffee-mug',[-6.2,.69,-3.63],.12,.1,.18,palette.ceramic,18);
  const magazine = boxMesh('coffee-book',[-6.9,.63,-3.9],[.64,.035,.43],palette.blue,root,true,true); magazine.rotation.y=.16;

  addBookcase();
  function addBookcase() {
    const shelf = new THREE.Group();
    shelf.name='west-bookcase';
    shelf.position.set(-12.15,0,-7.65);
    root.add(shelf);
    boxMesh('bookcase-back',[0,1.15,0],[.24,2.3,2.75],palette.darkWood,shelf,true,true);
    for (const y of [.12,.68,1.24,1.8,2.28]) boxMesh(`bookcase-shelf-${y}`,[.17,y,0],[.58,.1,2.78],palette.lightWood,shelf,true,true);
    for (const z of [-1.25,1.25]) boxMesh(`bookcase-side-${z}`,[.16,1.16,z],[.58,2.32,.12],palette.lightWood,shelf,true,true);
    const bookMats=[palette.red,palette.blue,palette.yellow,palette.fabricGreen,palette.fabricCream];
    let n=0;
    for(const y of [.22,.78,1.34,1.9]) {
      for(let z=-1.15;z<1.05;z+=.18) {
        const h=.27+((n*37)%17)/100;
        boxMesh(`book-${n++}`,[.47,y+h/2,z],[.16,h,.13],bookMats[n%bookMats.length],shelf,true,true).rotation.x=(n%5-2)*.018;
      }
    }
    shelf.updateWorldMatrix(true,true);
    registerObstacle('west-bookcase-obstacle',shelf,'living-room','shelf');
    addSurface({id:'bookcase-top',room:'living-room',type:'shelf',minX:-12.44,maxX:-11.86,minZ:-9.04,maxZ:-6.26,y:2.38,object:shelf,softness:.05,friction:.8,tags:['high','narrow']});
    addInterest('bookcase-high-perch','perch','Highest quiet bookcase perch',[-11.96,2.42,-7.55],'living-room',{radius:.75,utility:.88,heightPreference:1,object:shelf,tags:['high','quiet','lookout']});
  }

  const tvStand=obstacleBox('tv-stand','living-room',[-3.15,.34,-7.55],[.68,.68,3.55],palette.darkWood,'cabinet',{surface:true});
  const tv=obstacleBox('television','living-room',[-3.04,1.22,-7.55],[.12,1.2,2.25],palette.screen,'appliance');
  addInterest('television-motion','watch','Moving light and quiet speaker sounds',[-3.0,.9,-7.55],'living-room',{radius:1.5,utility:.34,object:tv.mesh,tags:['motion','sound','light']});

  addCatTree();
  function addCatTree() {
    const tree=new THREE.Group(); tree.name='cat-tree'; tree.position.set(-3.25,0,.35); root.add(tree);
    const base=boxMesh('cat-tree-base',[0,.07,0],[1.45,.14,1.2],palette.fabricCream,tree,true,true);
    const postData=[[-.43,.55,0,.9],[.39,.82,.18,1.45],[-.18,1.62,-.12,1.65]];
    for(let i=0;i<postData.length;i++) {
      const [x,y,z,h]=postData[i];
      const p=cylinderMesh(`cat-tree-post-${i}`,[x,y,z],.1,.1,h,palette.rope,20,tree);
      // Rope winding is suggested with thin dark torus rings.
      for(let ring=-h/2+.08;ring<h/2;ring+=.11) {
        const torus=new THREE.Mesh(new THREE.TorusGeometry(.103,.009,5,16),palette.darkWood);
        torus.position.set(x,y+ring,z); torus.rotation.x=Math.PI/2; tree.add(torus);
      }
      registerObstacle(`cat-tree-post-obstacle-${i}`,p,'living-room','scratch-post');
    }
    const platform1=boxMesh('cat-tree-platform-low',[-.36,.99,0],[.9,.12,.82],palette.fabricCream,tree,true,true);
    const platform2=boxMesh('cat-tree-platform-mid',[.37,1.56,.15],[.92,.12,.86],palette.fabricCream,tree,true,true);
    const platform3=boxMesh('cat-tree-platform-high',[-.18,2.49,-.08],[1.05,.13,.88],palette.fabricCream,tree,true,true);
    const basket=cylinderMesh('cat-tree-basket',[-.18,2.65,-.08],.48,.42,.25,palette.fabricCream,22,tree);
    const hide=boxMesh('cat-tree-hide',[.34,.55,.13],[.72,.58,.68],palette.fabricBlue,tree,true,true);
    const hole=new THREE.Mesh(new THREE.CircleGeometry(.19,20),palette.screen); hole.position.set(.34,.57,.477); tree.add(hole);
    tree.updateWorldMatrix(true,true);
    registerObstacle('cat-tree-base-obstacle',base,'living-room','cat-tree');
    for (const [id,obj,y,x,z,w,d] of [
      ['cat-tree-low-surface',platform1,.99+.06,-3.61,.35,.9,.82],
      ['cat-tree-mid-surface',platform2,1.62,-2.88,.5,.92,.86],
      ['cat-tree-high-surface',platform3,2.555,-3.43,.27,1.05,.88],
    ]) addSurface({id,room:'living-room',type:'cat-platform',minX:x-w/2,maxX:x+w/2,minZ:z-d/2,maxZ:z+d/2,y,object:obj,softness:.72,friction:1,tags:['climb','perch']});
    addInterest('cat-tree-scratch','scratch','Tall sisal scratching post',[-3.7,.55,.35],'living-room',{radius:.7,utility:.91,object:tree,tags:['scratch','stretch']});
    addInterest('cat-tree-hide','hide','Enclosed cat-tree den',[-2.91,.54,.48],'living-room',{radius:.55,utility:.83,object:hide,tags:['covered','quiet']});
    addInterest('cat-tree-crown','rest','High bolstered cat-tree basket',[-3.43,2.78,.27],'living-room',{radius:.72,utility:.97,heightPreference:1,object:basket,tags:['high','soft','secure']});
    addInteractable('cat-tree','climbable','Cat tree',tree,'living-room',[-3.25,0,.35],null,{radius:1.4,levels:3});
  }

  addScratcher('living-scratcher',[-8.2,.03,-7.9],0,'living-room');
  addTunnel('living-tunnel',[-5.0,.43,-.25],Math.PI/2,'living-room');
  addCardboardBox('living-box-large',[-5.3,.02,-8.35],1.05,.82,.75,'living-room');
  addCardboardBox('living-box-small',[-6.5,.02,-8.7],.72,.62,.54,'living-room');

  function addScratcher(id, position, rotation, room) {
    const group=new THREE.Group(); group.name=id; group.position.set(...position); group.rotation.y=rotation; root.add(group);
    const base=boxMesh(`${id}-base`,[0,.035,0],[.72,.07,.44],palette.darkWood,group,true,true);
    const pad=boxMesh(`${id}-pad`,[0,.075,0],[.62,.055,.35],palette.cardboard,group,true,true);
    for(let x=-.27;x<=.27;x+=.045) boxMesh(`${id}-corrugation-${x}`,[x,.108,0],[.012,.008,.33],palette.darkWood,group,false,true);
    group.updateWorldMatrix(true,true);
    registerObstacle(`${id}-obstacle`,base,room,'scratcher');
    addInterest(`${id}-interest`,'scratch','Horizontal corrugated scratch pad',new THREE.Vector3(...position).add(new THREE.Vector3(0,.11,0)),room,{radius:.7,utility:.77,object:pad,tags:['scratch','ground']});
    addInteractable(id,'scratcher','Corrugated scratcher',pad,room,position,null,{radius:.8});
  }

  function addTunnel(id, position, rotation, room) {
    const group=new THREE.Group(); group.name=id; group.position.set(...position); group.rotation.y=rotation; root.add(group);
    const shell=new THREE.Mesh(new THREE.CylinderGeometry(.43,.43,1.85,26,1,true),material(0x4d7186,.86,0,{side:THREE.DoubleSide}));
    shell.rotation.z=Math.PI/2; shell.castShadow=true; shell.receiveShadow=true; group.add(shell);
    for(const x of [-.925,.925]) { const ring=new THREE.Mesh(new THREE.TorusGeometry(.43,.028,7,28),palette.blue); ring.position.x=x; ring.rotation.y=Math.PI/2; group.add(ring); }
    const crinkle=boxMesh(`${id}-crinkle`,[0,-.395,0],[1.82,.018,.48],palette.fabricBlue,group,false,true);
    addInterest(`${id}-hide`,'hide','Crinkly two-exit play tunnel',new THREE.Vector3(...position),room,{radius:1,utility:.82,object:shell,tags:['covered','ambush','two-exit']});
    addInteractable(id,'tunnel','Play tunnel',shell,room,position,null,{radius:1.2,passable:true});
    return crinkle;
  }

  function addCardboardBox(id, position, width, depth, height, room) {
    const group=new THREE.Group(); group.name=id; group.position.set(...position); root.add(group);
    const t=.045;
    const bottom=boxMesh(`${id}-bottom`,[0,t/2,0],[width,t,depth],palette.cardboard,group,true,true);
    const left=boxMesh(`${id}-left`,[-width/2+t/2,height/2,0],[t,height,depth],palette.cardboard,group,true,true);
    const right=boxMesh(`${id}-right`,[width/2-t/2,height/2,0],[t,height,depth],palette.cardboard,group,true,true);
    const back=boxMesh(`${id}-back`,[0,height/2,-depth/2+t/2],[width,height,t],palette.cardboard,group,true,true);
    const frontL=boxMesh(`${id}-front-left`,[-width*.36,height*.32,depth/2-t/2],[width*.28,height*.64,t],palette.cardboard,group,true,true);
    const frontR=boxMesh(`${id}-front-right`,[width*.36,height*.32,depth/2-t/2],[width*.28,height*.64,t],palette.cardboard,group,true,true);
    group.updateWorldMatrix(true,true);
    for(const [suffix,obj] of [['bottom',bottom],['left',left],['right',right],['back',back],['front-left',frontL],['front-right',frontR]]) registerObstacle(`${id}-${suffix}-obstacle`,obj,room,'box-wall');
    addInterest(`${id}-hide`,'hide','Cardboard hide with a clear exit',[position[0],height*.35,position[2]],room,{radius:.7,utility:.84,object:group,tags:['covered','cardboard','ambush']});
    addInteractable(id,'box','Cardboard box',group,room,position,null,{radius:.9,enterable:true});
  }

  // -------------------------------------------------------------------------
  // Kitchen: working surfaces, appliances and separated feeding resources.
  // -------------------------------------------------------------------------

  addKitchenCounters();
  function addKitchenCounters() {
    // North-facing run along the garden wall.
    for (const [id,x,w] of [['west',2.05,2.1],['middle',3.95,1.45],['east',10.9,3.4]]) {
      obstacleBox(`kitchen-base-${id}`,'kitchen',[x,.43,-9.25],[w,.86,1.15],palette.lightWood,'cabinet');
      obstacleBox(`kitchen-counter-${id}`,'kitchen',[x,.91,-9.25],[w+.1,.1,1.25],palette.darkTrim,'counter',{surface:true,friction:.66});
      for(let drawerX=x-w/2+.35;drawerX<x+w/2;drawerX+=.7) {
        boxMesh(`drawer-${id}-${drawerX}`,[drawerX,.64,-8.655],[.58,.24,.035],palette.wood,root,true,true);
        boxMesh(`drawer-handle-${id}-${drawerX}`,[drawerX,.64,-8.626],[.24,.025,.045],palette.steel,root,true,true);
      }
    }
    // East wall counter makes an L and provides a broad cat route.
    obstacleBox('kitchen-east-base','kitchen',[12.15,.43,-5.75],[1.2,.86,5.15],palette.lightWood,'cabinet');
    obstacleBox('kitchen-east-counter','kitchen',[12.13,.91,-5.75],[1.28,.1,5.25],palette.darkTrim,'counter',{surface:true,friction:.66});
    const sink=boxMesh('kitchen-sink',[10.86,.975,-9.22],[1.12,.035,.72],palette.steel,root,true,true);
    const basin=boxMesh('kitchen-sink-basin',[10.86,.983,-9.22],[.86,.025,.52],palette.screen,root,false,true);
    const faucet=cylinderMesh('kitchen-faucet',[10.86,1.24,-9.52],.035,.035,.48,palette.steel,10);
    faucet.rotation.x=.28;
    addInterest('sink-water','drink','Occasional droplets at the kitchen sink',[10.87,1.03,-9.2],'kitchen',{radius:.7,utility:.33,object:sink,tags:['water','counter','uncertain']});
    const stove=boxMesh('kitchen-hob',[3.92,.98,-9.19],[1.12,.025,.72],palette.screen,root,false,true);
    for(const x of [3.62,4.2]) for(const z of [-9.43,-8.98]) { const ring=new THREE.Mesh(new THREE.TorusGeometry(.18,.018,7,22),palette.steel); ring.rotation.x=Math.PI/2; ring.position.set(x,1.005,z); root.add(ring); }
    addInterest('counter-route','perch','Continuous kitchen counter route',[11.7,1.03,-6.4],'kitchen',{radius:1.5,utility:.58,heightPreference:.55,tags:['elevated','food-scent']});
  }

  const fridge=obstacleBox('refrigerator','kitchen',[2.0,1.18,-1.1],[1.2,2.36,1.15],palette.steel,'appliance',{surface:true,climbable:false});
  boxMesh('fridge-divider',[2.0,1.17,-.513],[1.05,.025,.025],palette.darkTrim,root,false,true);
  boxMesh('fridge-handle',[2.48,1.48,-.47],[.055,.62,.07],palette.darkTrim,root,true,true);
  addInterest('fridge-hum','investigate','Low refrigerator hum',[2.0,.38,-.46],'kitchen',{radius:1.1,utility:.28,object:fridge.mesh,tags:['sound','warm-air']});

  const island=obstacleBox('kitchen-island','kitchen',[7.05,.45,-4.9],[3.05,.9,1.55],palette.wood,'island');
  const islandTop=obstacleBox('kitchen-island-top','kitchen',[7.05,.95,-4.9],[3.28,.1,1.72],palette.concrete,'counter',{surface:true,friction:.69});
  for(const x of [5.9,6.55,7.2,7.85]) boxMesh(`island-slat-${x}`,[x,.46,-4.09],[.04,.71,.04],palette.darkWood,root,true,true);
  addInterest('island-overview','perch','Central kitchen island',[7.05,1.04,-4.9],'kitchen',{radius:1.3,utility:.62,heightPreference:.52,object:islandTop.mesh,tags:['elevated','food-scent','central']});

  addDiningSet();
  function addDiningSet() {
    const top=obstacleBox('dining-table-top','kitchen',[7.65,.78,-.7],[3.5,.12,1.8],palette.lightWood,'table',{surface:true,friction:.74});
    for(const x of [6.25,9.05]) for(const z of [-1.33,-.07]) obstacleBox(`dining-leg-${x}-${z}`,'kitchen',[x,.38,z],[.14,.76,.14],palette.darkWood,'table-leg');
    for(const [i,x,z,r] of [[0,5.65,-.72,0],[1,9.65,-.72,0],[2,7.65,-1.83,Math.PI/2]]) {
      const chair=new THREE.Group(); chair.name=`dining-chair-${i}`; chair.position.set(x,0,z); chair.rotation.y=r; root.add(chair);
      boxMesh(`chair-seat-${i}`,[0,.45,0],[.75,.12,.72],palette.wood,chair,true,true);
      boxMesh(`chair-back-${i}`,[0,.88,.3],[.76,.82,.1],palette.wood,chair,true,true);
      for(const lx of [-.28,.28]) for(const lz of [-.25,.25]) boxMesh(`chair-leg-${i}-${lx}-${lz}`,[lx,.22,lz],[.08,.44,.08],palette.darkWood,chair,true,true);
      chair.updateWorldMatrix(true,true); registerObstacle(`dining-chair-obstacle-${i}`,chair,'kitchen','chair');
      addSurface({id:`chair-seat-surface-${i}`,room:'kitchen',type:'chair',minX:x-.37,maxX:x+.37,minZ:z-.36,maxZ:z+.36,y:.51,object:chair,softness:.12,friction:.8,tags:['step','seat']});
    }
    addInterest('dining-table-scent','investigate','Dining table food traces',[7.65,.88,-.7],'kitchen',{radius:1.3,utility:.52,object:top.mesh,tags:['food-scent','elevated']});
  }

  addBowl('food', [3.25,.035,-3.05], 'kitchen');
  addBowl('water', [10.7,.035,-2.05], 'kitchen');
  addTreatJar();

  function addBowl(kind, position, room) {
    const group=new THREE.Group(); group.name=`${kind}-bowl`; group.position.set(...position); root.add(group);
    const bowlMat=kind==='water' ? palette.blue : palette.ceramic;
    const outer=new THREE.Mesh(new THREE.CylinderGeometry(.25,.19,.105,28,1,true),bowlMat); outer.position.y=.06; outer.castShadow=true; group.add(outer);
    const rim=new THREE.Mesh(new THREE.TorusGeometry(.25,.025,7,28),bowlMat); rim.rotation.x=Math.PI/2; rim.position.y=.112; group.add(rim);
    const fill=new THREE.Mesh(new THREE.CircleGeometry(.21,28),kind==='water'?palette.water:palette.food); fill.rotation.x=-Math.PI/2; fill.position.y=.108; group.add(fill);
    const state={kind,fullness:kind==='water'?.82:.72,fill,baseY:.108,lastRefill:0};
    resources[kind]=state;
    addInterest(`${kind}-bowl-interest`,kind,kind==='water'?'Fresh water bowl':'Food bowl',[position[0],.13,position[2]],room,{radius:.65,utility:.95,object:group,state,tags:[kind,'resource']});
    addInteractable(`${kind}-bowl`,kind,kind==='water'?'Water bowl':'Food bowl',group,room,position,()=>refill(kind),{radius:.7,fullness:state.fullness});
  }

  function addTreatJar() {
    const group=new THREE.Group(); group.name='treat-jar'; group.position.set(7.55,1.04,-4.88); root.add(group);
    const jarMat=material(0xc8d7d5,.08,.04,{transparent:true,opacity:.42,side:THREE.DoubleSide});
    const glass=new THREE.Mesh(new THREE.CylinderGeometry(.19,.2,.42,24,1,true),jarMat);
    glass.name='treat-jar-glass'; glass.position.y=.21; glass.castShadow=true; group.add(glass);
    const bottom=new THREE.Mesh(new THREE.CylinderGeometry(.19,.19,.025,24),jarMat);
    bottom.name='treat-jar-bottom'; bottom.position.y=.012; group.add(bottom);
    const lid=new THREE.Mesh(new THREE.CylinderGeometry(.205,.205,.075,24),palette.darkTrim);
    lid.name='treat-jar-lid'; lid.position.y=.46; lid.castShadow=true; group.add(lid);
    const treatMat=material(0x8b5a37,.94,0);
    const pieces=[];
    for(let i=0;i<9;i++) {
      const treat=boxMesh(`treat-piece-${i}`,[((i*47)%9-4)*.033,.065+Math.floor(i/4)*.055,((i*31)%7-3)*.035],[.058,.045,.052],treatMat,group,true,true);
      treat.rotation.set(i*.23,i*.57,i*.19); pieces.push(treat);
    }
    const state={servings:9,pieces,action:'dispense-treat'};
    resources.treats=state;
    const dispense=()=>{
      if(state.servings<=0) return false;
      state.servings--;
      if(pieces[state.servings]) pieces[state.servings].visible=false;
      return true;
    };
    group.updateWorldMatrix(true,true);
    registerObstacle('treat-jar-obstacle',group,'kitchen','small-object');
    addInterest('treat-jar-scent','food','Sealed jar with a familiar treat scent',[7.55,1.28,-4.88],'kitchen',{radius:.72,utility:.82,object:group,state,tags:['food-scent','container','counter']});
    addInteractable('treat-jar','treat','Treat jar',group,'kitchen',[7.55,1.24,-4.88],dispense,{radius:.72,servings:state.servings,action:'dispense-treat'});
  }

  // -------------------------------------------------------------------------
  // Bedroom: deep soft surfaces, under-bed cover and a climbable wardrobe route.
  // -------------------------------------------------------------------------

  addBed();
  function addBed() {
    const bed=new THREE.Group(); bed.name='bed'; bed.position.set(-7.65,0,6.35); root.add(bed);
    const frame=boxMesh('bed-frame',[0,.29,0],[4.35,.38,3.15],palette.darkWood,bed,true,true);
    for(const x of [-1.9,1.9]) for(const z of [-1.32,1.32]) boxMesh(`bed-leg-${x}-${z}`,[x,.14,z],[.14,.28,.14],palette.darkWood,bed,true,true);
    const mattress=boxMesh('bed-mattress',[0,.62,0],[4.16,.34,2.98],palette.fabricCream,bed,true,true);
    const duvet=boxMesh('bed-duvet',[.35,.83,.12],[3.32,.16,2.85],palette.fabricBlue,bed,true,true);
    for(const x of [-1.27,.0]) { const pillow=boxMesh(`bed-pillow-${x}`,[x,.89,-.98],[1.05,.2,.68],palette.white,bed,true,true); pillow.rotation.y=.05+x*.03; }
    boxMesh('bed-headboard',[0,1.15,-1.52],[4.42,1.7,.16],palette.darkWood,bed,true,true);
    bed.updateWorldMatrix(true,true); registerObstacle('bed-obstacle',frame,'bedroom','bed'); registerObstacle('bed-mattress-obstacle',mattress,'bedroom','mattress');
    addSurface({id:'bed-surface',room:'bedroom',type:'bed',minX:-9.65,maxX:-5.58,minZ:4.9,maxZ:7.8,y:.91,object:duvet,softness:1,friction:1.12,tags:['soft','warm','rest']});
    addInterest('bed-nap','rest','Deep warm duvet fold',[-6.7,.95,6.55],'bedroom',{radius:1.25,utility:1,heightPreference:.45,object:duvet,tags:['soft','warm','familiar-scent']});
    addInterest('under-bed-hide','hide','Dark space beneath the bed',[-7.7,.18,6.4],'bedroom',{radius:1.4,utility:.9,object:frame,tags:['covered','dark','quiet']});
  }

  obstacleBox('bedside-table','bedroom',[-10.65,.38,5.05],[1.05,.76,.92],palette.lightWood,'table',{surface:true});
  const lampBase=cylinderMesh('bedside-lamp-base',[-10.65,.84,5.05],.15,.18,.18,palette.steel,18);
  const lampShade=new THREE.Mesh(new THREE.CylinderGeometry(.21,.36,.48,20,1,true),palette.warmGlow); lampShade.position.set(-10.65,1.16,5.05); root.add(lampShade);
  const lampLight=new THREE.PointLight(0xffc77b,1.3,5.2,2); lampLight.position.set(-10.65,1.3,5.05); lampLight.castShadow=false; root.add(lampLight);
  animated.push({type:'lamp',light:lampLight,base:1.3,phase:2.1});

  addWardrobe();
  function addWardrobe() {
    const wardrobe=obstacleBox('wardrobe','bedroom',[-2.0,1.2,7.9],[1.6,2.4,3.2],palette.darkWood,'wardrobe',{surface:true,climbable:true});
    boxMesh('wardrobe-door-line',[-2.81,1.22,7.9],[.025,2.12,.025],palette.steel,root,false,true);
    for(const z of [7.72,8.08]) sphereMesh(`wardrobe-knob-${z}`,[-2.84,1.23,z],.045,palette.steel,[1,1,1],root,10);
    addInterest('wardrobe-top','perch','Tall private wardrobe top',[-2.0,2.44,7.9],'bedroom',{radius:1.15,utility:.92,heightPreference:1,object:wardrobe.mesh,tags:['high','quiet','secure']});
    addRamp('wardrobe-ramp','bedroom',[-3.28,.04,7.9],.55,2.2,.07,0,1.85,'x');
  }

  const dresser=obstacleBox('bedroom-dresser','bedroom',[-11.7,.54,8.45],[1.8,1.08,2.3],palette.lightWood,'dresser',{surface:true});
  for(const y of [.25,.55,.85]) { boxMesh(`dresser-line-${y}`,[-10.788,y,8.45],[.025,.02,2.08],palette.darkWood,root,false,true); boxMesh(`dresser-pull-${y}`,[-10.76,y,8.45],[.035,.06,.4],palette.steel,root,true,true); }
  addInterest('dresser-perch','perch','Dresser observation platform',[-11.6,1.12,8.4],'bedroom',{radius:.9,utility:.64,heightPreference:.62,object:dresser.mesh,tags:['elevated','quiet']});

  const bedroomRug=boxMesh('bedroom-rug',[-4.1,.019,4.9],[3.4,.035,2.05],palette.fabricCream,root,false,true);
  addSurface({id:'bedroom-rug-surface',room:'bedroom',type:'rug',minX:-5.8,maxX:-2.4,minZ:3.87,maxZ:5.93,y:.04,object:bedroomRug,softness:.9,friction:1.08,tags:['soft']});
  addScratcher('bedroom-scratcher',[-5.35,.03,8.65],Math.PI/2,'bedroom');

  // -------------------------------------------------------------------------
  // Bathroom: washable fixtures and a private, distant litter resource.
  // -------------------------------------------------------------------------

  const tub=obstacleBox('bathtub','bathroom',[2.0,.38,7.65],[1.5,.76,3.65],palette.porcelain,'bath',{surface:false});
  const tubInner=boxMesh('bathtub-inner',[2.0,.77,7.65],[1.08,.025,3.08],palette.screen,root,false,true);
  addSurface({id:'tub-rim-left',room:'bathroom',type:'bath-rim',minX:1.25,maxX:1.48,minZ:5.82,maxZ:9.47,y:.78,object:tub.mesh,friction:.45,tags:['narrow','slippery']});
  addSurface({id:'tub-rim-right',room:'bathroom',type:'bath-rim',minX:2.52,maxX:2.75,minZ:5.82,maxZ:9.47,y:.78,object:tub.mesh,friction:.45,tags:['narrow','slippery']});
  addInterest('bath-drip','investigate','Intermittent bath tap drip',[2.0,.86,6.1],'bathroom',{radius:.6,utility:.35,object:tubInner,tags:['water','sound','slippery']});
  const tap=cylinderMesh('bath-tap',[2.0,1.01,6.05],.05,.05,.42,palette.steel,12); tap.rotation.x=Math.PI/2;

  const toiletBase=cylinderMesh('toilet-base',[4.9,.28,8.55],.34,.41,.56,palette.porcelain,24);
  const toiletSeat=new THREE.Mesh(new THREE.TorusGeometry(.39,.09,9,24)); toiletSeat.material=palette.porcelain; toiletSeat.scale.z=1.25; toiletSeat.rotation.x=Math.PI/2; toiletSeat.position.set(4.9,.61,8.5); root.add(toiletSeat);
  obstacleBox('toilet-tank','bathroom',[4.9,.91,9.18],[.82,.72,.42],palette.porcelain,'fixture',{surface:true,climbable:true});
  registerObstacle('toilet-base-obstacle',toiletBase,'bathroom','fixture');

  obstacleBox('bath-vanity','bathroom',[5.12,.43,2.85],[1.65,.86,1.15],palette.lightWood,'cabinet');
  obstacleBox('bath-counter','bathroom',[5.12,.91,2.85],[1.76,.1,1.24],palette.concrete,'counter',{surface:true,friction:.58});
  const basin=cylinderMesh('bath-basin',[5.12,.99,2.85],.42,.34,.12,palette.porcelain,24);
  addInterest('basin-drip','drink','Cool bathroom basin',[5.12,1.08,2.85],'bathroom',{radius:.65,utility:.28,object:basin,tags:['water','counter']});
  const mirror=boxMesh('bath-mirror',[6.02,1.8,2.85],[.035,1.28,1.28],palette.glass,root,false,true);
  addInterest('mirror-cat','investigate','Unfamiliar reflected cat',[5.88,1.1,2.85],'bathroom',{radius:.85,utility:.38,object:mirror,tags:['reflection','visual']});

  addLitterBox();
  function addLitterBox() {
    const group=new THREE.Group(); group.name='litter-box'; group.position.set(4.72,.02,6.15); root.add(group);
    const bottom=boxMesh('litter-bottom',[0,.07,0],[1.35,.14,1.04],palette.tileDark,group,true,true);
    for(const [id,p,s] of [
      ['back',[0,.22,-.49],[1.35,.42,.08]], ['left',[-.635,.18,0],[.08,.34,1.04]],
      ['right',[.635,.18,0],[.08,.34,1.04]], ['front-left',[-.47,.14,.49],[.4,.25,.08]],
      ['front-right',[.47,.14,.49],[.4,.25,.08]],
    ]) boxMesh(`litter-wall-${id}`,p,s,palette.tileDark,group,true,true);
    const fill=boxMesh('litter-fill',[0,.155,0],[1.16,.09,.86],palette.litter,group,false,true);
    const clumps=[];
    for(const [x,z,s] of [[-.3,-.1,.11],[.28,.19,.08],[.05,-.27,.07]]) clumps.push(sphereMesh(`litter-clump-${x}-${z}`,[x,.23,z],s,palette.soil,[1.2,.35,1],group,10));
    group.updateWorldMatrix(true,true); registerObstacle('litter-box-obstacle',bottom,'bathroom','litter-tray');
    const state={cleanliness:.76,clumps,fill,lastClean:0}; resources.litter=state;
    addInterest('litter-interest','litter','Private litter tray',[4.72,.22,6.15],'bathroom',{radius:.86,utility:.98,object:group,state,tags:['resource','private','diggable']});
    addInteractable('litter-box','litter','Litter tray',group,'bathroom',[4.72,.02,6.15],cleanLitter,{radius:1,cleanliness:state.cleanliness});
  }

  // -------------------------------------------------------------------------
  // Hall and stairs: a legible multi-height route, handrail and quiet undercroft.
  // -------------------------------------------------------------------------

  addStairs();
  function addStairs() {
    const startZ=3.0, stepDepth=.68, stepWidth=3.15, count=10, rise=.235;
    for(let i=0;i<count;i++) {
      const h=(i+1)*rise;
      const z=startZ+i*stepDepth;
      const step=obstacleBox(`stair-${i}`,'hall-stairs',[10.72,h/2,z],[stepWidth,h,stepDepth+.025],palette.wood,'stair');
      addSurface({id:`stair-tread-${i}`,room:'hall-stairs',type:'stair',minX:10.72-stepWidth/2,maxX:10.72+stepWidth/2,minZ:z-stepDepth/2,maxZ:z+stepDepth/2,y:h,object:step.mesh,friction:.86,tags:['step','route','elevated']});
    }
    const landing=obstacleBox('upper-landing','hall-stairs',[10.72,2.285,9.18],[3.2,.13,1.25],palette.wood,'landing',{surface:true});
    for(let i=0;i<=10;i++) {
      const z=startZ+i*stepDepth;
      const y=.68+i*rise;
      cylinderMesh(`banister-${i}`,[8.98,y,z],.035,.035,1.12,palette.darkWood,10);
    }
    const rail=boxMesh('stair-handrail',[8.98,1.81,6.08],[.1,.11,7.45],palette.darkWood,root,true,true); rail.rotation.x=-Math.atan((10*rise)/6.8);
    addInterest('upper-stair-lookout','perch','Upper stair landing',[10.72,2.39,9.12],'hall-stairs',{radius:1.2,utility:.82,heightPreference:1,object:landing.mesh,tags:['high','route','lookout']});
    addInterest('under-stair-hide','hide','Protected shadow under the stairs',[10.65,.3,4.4],'hall-stairs',{radius:1.1,utility:.79,tags:['covered','quiet','dark']});
  }

  const hallRunner=boxMesh('hall-runner',[7.35,.02,6.2],[1.38,.035,5.6],palette.fabricRust,root,false,true);
  addSurface({id:'hall-runner-surface',room:'hall-stairs',type:'rug',minX:6.66,maxX:8.04,minZ:3.4,maxZ:9,y:.04,object:hallRunner,softness:.65,friction:1.05});
  const hallConsole=obstacleBox('hall-console','hall-stairs',[7.02,.51,9.25],[1.25,1.02,.52],palette.darkWood,'table',{surface:true});
  addInterest('hall-console-perch','perch','Narrow hall console',[7.02,1.06,9.25],'hall-stairs',{radius:.65,utility:.48,heightPreference:.55,object:hallConsole.mesh,tags:['narrow','route']});
  addScratcher('hall-scratcher',[7.1,.03,2.65],Math.PI/2,'hall-stairs');

  // A shallow assistance ramp allows older cats to reach the sofa route.
  addRamp('sofa-ramp','living-room',[-11.8,.04,-2.0],.54,1.65,.065,0,.58,'z');
  function addRamp(id, room, origin, width, length, thickness, lowY, highY, axis='z') {
    const rise=highY-lowY;
    const angle=Math.atan2(rise,length);
    const mesh=boxMesh(id,[origin[0],lowY+rise/2,origin[2]],[axis==='x'?length:width,thickness,axis==='x'?width:length],palette.carpet,root,true,true);
    if(axis==='z') mesh.rotation.x=-angle; else mesh.rotation.z=angle;
    mesh.updateWorldMatrix(true,true);
    registerObstacle(`${id}-obstacle`,mesh,room,'ramp');
    const halfL=length/2;
    const minX=origin[0]-(axis==='x'?halfL:width/2), maxX=origin[0]+(axis==='x'?halfL:width/2);
    const minZ=origin[2]-(axis==='z'?halfL:width/2), maxZ=origin[2]+(axis==='z'?halfL:width/2);
    const heightAt=(x,z)=>lowY + rise * Math.max(0,Math.min(1,((axis==='z'?z-origin[2]:x-origin[0])+halfL)/length));
    const normal=axis==='z'?new THREE.Vector3(0,1,-rise/length):new THREE.Vector3(-rise/length,1,0);
    addSurface({id:`${id}-surface`,room,type:'ramp',minX,maxX,minZ,maxZ,y:lowY,normal,heightAt,object:mesh,softness:.45,friction:1.05,tags:['ramp','accessible']});
    addInterest(`${id}-route`,'route','Gentle carpeted ramp',[origin[0],lowY+rise/2+.05,origin[2]],room,{radius:.7,utility:.38,object:mesh,tags:['ramp','accessible']});
    return mesh;
  }

  // -------------------------------------------------------------------------
  // Garden: bounded outdoor room with paths, sensory cover and lookout points.
  // -------------------------------------------------------------------------

  const patio=boxMesh('garden-patio',[6.8,.005,-12.05],[11.9,.07,3.75],palette.concrete,root,false,true);
  addSurface({id:'patio-surface',room:'garden',type:'patio',minX:.85,maxX:12.75,minZ:-13.93,maxZ:-10.17,y:.045,object:patio,friction:.82,tags:['outdoor','hard']});
  for(let x=1.2;x<12.7;x+=.75) boxMesh(`patio-joint-x-${x}`,[x,.047,-12.05],[.018,.008,3.65],palette.stone,root,false,true);
  for(let z=-13.65;z<-10.2;z+=.75) boxMesh(`patio-joint-z-${z}`,[6.8,.047,z],[11.75,.008,.018],palette.stone,root,false,true);

  // Broad stepping-stone trail connects the door to tree, herb bed and shelter.
  for(let i=0;i<11;i++) {
    const x=6.6-i*1.12;
    const z=-13.75-i*.48+Math.sin(i*.7)*.35;
    const stone=sphereMesh(`path-stone-${i}`,[x,.03,z],.52,palette.stone,[1,.11,.72],root,14);
    addSurface({id:`path-stone-surface-${i}`,room:'garden',type:'stone',minX:x-.5,maxX:x+.5,minZ:z-.36,maxZ:z+.36,y:.087,object:stone,friction:.72,tags:['outdoor','path']});
  }

  addFence();
  function addFence() {
    for(let x=-12.55;x<=12.55;x+=.72) {
      obstacleBox(`south-fence-slat-${x}`,'garden',[x,.72,-19.82],[.11,1.44,.09],palette.darkWood,'fence');
    }
    for(let z=-19.45;z<=-10.55;z+=.72) {
      obstacleBox(`west-fence-slat-${z}`,'garden',[-12.82,.72,z],[.09,1.44,.11],palette.darkWood,'fence');
      obstacleBox(`east-fence-slat-${z}`,'garden',[12.82,.72,z],[.09,1.44,.11],palette.darkWood,'fence');
    }
    for(const [axis,pos,size] of [
      ['south-low',[0,.38,-19.78],[25.7,.1,.12]],['south-high',[0,1.05,-19.78],[25.7,.1,.12]],
      ['west-low',[-12.78,.38,-15],[.12,.1,9.7]],['west-high',[-12.78,1.05,-15],[.12,.1,9.7]],
      ['east-low',[12.78,.38,-15],[.12,.1,9.7]],['east-high',[12.78,1.05,-15],[.12,.1,9.7]],
    ]) obstacleBox(`fence-rail-${axis}`,'garden',pos,size,palette.wood,'fence');
  }

  addGardenTree();
  function addGardenTree() {
    const tree=new THREE.Group(); tree.name='garden-tree'; tree.position.set(-6.6,0,-16.1); root.add(tree);
    const trunk=cylinderMesh('garden-tree-trunk',[0,1.5,0],.39,.54,3,palette.darkWood,16,tree);
    trunk.rotation.z=.045;
    for(const [i,x,y,z,s] of [[0,-.85,2.8,0,1.2],[1,.65,3.1,.15,1.3],[2,0,3.65,-.2,1.5],[3,-.2,2.9,-.8,1.1]]) sphereMesh(`tree-canopy-${i}`,[x,y,z],s,palette.leaf,[1.2,.8,1],tree,14);
    const branch=cylinderMesh('garden-tree-branch',[.35,2.28,0],.15,.22,1.75,palette.darkWood,12,tree); branch.rotation.z=-.72;
    tree.updateWorldMatrix(true,true); registerObstacle('garden-tree-trunk-obstacle',trunk,'garden','tree'); registerObstacle('garden-tree-branch-obstacle',branch,'garden','tree');
    addSurface({id:'tree-low-branch',room:'garden',type:'branch',minX:-6.45,maxX:-5.25,minZ:-16.35,maxZ:-15.85,y:2.55,object:branch,friction:.75,tags:['branch','high','narrow']});
    addInterest('tree-trunk-scratch','scratch','Rough garden tree bark',[-6.5,.7,-16.1],'garden',{radius:.9,utility:.9,object:trunk,tags:['scratch','outdoor','scent']});
    addInterest('tree-branch-lookout','perch','Low tree-branch lookout',[-5.75,2.6,-16.1],'garden',{radius:.9,utility:.94,heightPreference:1,object:branch,tags:['high','outdoor','birdwatch']});
    animated.push({type:'sway',object:tree,base:tree.rotation.z,phase:1.4,amplitude:.004});
  }

  addPlanter(-10.4,-12.1,2.7,1.1,'cat-safe grass');
  addPlanter(-9.8,-18.25,3.7,1.15,'herbs');
  function addPlanter(x,z,w,d,label) {
    const group=new THREE.Group(); group.name=`planter-${label}`; group.position.set(x,0,z); root.add(group);
    const base=boxMesh(`${label}-planter-base`,[0,.24,0],[w,.48,d],palette.cardboard,group,true,true);
    const soil=boxMesh(`${label}-soil`,[0,.49,0],[w-.18,.08,d-.18],palette.soil,group,false,true);
    const grassMat=label==='cat-safe grass'?palette.leafLight:palette.leaf;
    for(let i=0;i<34;i++) {
      const rx=((i*73)%101)/101-.5, rz=((i*47)%97)/97-.5;
      const blade=boxMesh(`${label}-plant-${i}`,[rx*(w-.3),.67+((i*29)%13)/150,rz*(d-.28)],[.025,.32+((i*17)%11)/100,.025],grassMat,group,true,true);
      blade.rotation.z=rx*.25;
    }
    group.updateWorldMatrix(true,true); registerObstacle(`${label}-planter-obstacle`,base,'garden','planter');
    addSurface({id:`${label}-planter-rim`,room:'garden',type:'planter',minX:x-w/2,maxX:x+w/2,minZ:z-d/2,maxZ:z+d/2,y:.53,object:soil,friction:.72,tags:['outdoor','soil']});
    addInterest(`${label}-sniff`,'sniff',label==='cat-safe grass'?'Cat-safe grass bed':'Dense aromatic herb bed',[x,.58,z],'garden',{radius:1,utility:.72,object:group,tags:['plant','scent','outdoor']});
  }

  addGardenShelter();
  function addGardenShelter() {
    const shelter=new THREE.Group(); shelter.name='garden-shelter'; shelter.position.set(9.75,0,-17.15); root.add(shelter);
    const floor=boxMesh('shelter-floor',[0,.15,0],[2.2,.18,1.65],palette.darkWood,shelter,true,true);
    boxMesh('shelter-back',[0,.92,-.76],[2.2,1.55,.14],palette.wood,shelter,true,true);
    boxMesh('shelter-left',[-1.03,.92,0],[.14,1.55,1.65],palette.wood,shelter,true,true);
    boxMesh('shelter-right',[1.03,.92,0],[.14,1.55,1.65],palette.wood,shelter,true,true);
    const roof=boxMesh('shelter-roof',[0,1.77,0],[2.55,.14,2.0],palette.red,shelter,true,true); roof.rotation.z=.06;
    const bed=boxMesh('shelter-bed',[0,.29,.05],[1.52,.13,1.12],palette.fabricCream,shelter,true,true);
    shelter.updateWorldMatrix(true,true); registerObstacle('garden-shelter-floor-obstacle',floor,'garden','shelter');
    addSurface({id:'garden-shelter-bed',room:'garden',type:'bed',minX:8.99,maxX:10.51,minZ:-17.66,maxZ:-16.54,y:.355,object:bed,softness:.9,friction:1,tags:['covered','outdoor','soft']});
    addSurface({id:'garden-shelter-roof',room:'garden',type:'roof',minX:8.48,maxX:11.02,minZ:-18.15,maxZ:-16.15,y:1.84,object:roof,friction:.68,tags:['high','outdoor']});
    addInterest('garden-shelter-rest','rest','Dry covered garden bed',[9.75,.4,-17.1],'garden',{radius:1,utility:.91,object:bed,tags:['covered','soft','outdoor']});
  }

  const gardenBench=obstacleBox('garden-bench-seat','garden',[4.7,.52,-17.6],[2.65,.15,.72],palette.wood,'bench',{surface:true,softness:.05});
  obstacleBox('garden-bench-back','garden',[4.7,1.03,-17.93],[2.65,.95,.12],palette.wood,'bench');
  for(const x of [3.65,5.75]) obstacleBox(`garden-bench-leg-${x}`,'garden',[x,.27,-17.6],[.14,.54,.58],palette.darkWood,'bench-leg');
  addInterest('garden-bench-perch','perch','Weathered garden bench',[4.7,.63,-17.6],'garden',{radius:1.2,utility:.62,object:gardenBench.mesh,tags:['outdoor','elevated']});

  const birdBathBase=cylinderMesh('birdbath-base',[.3,.43,-17.35],.16,.27,.86,palette.stone,16);
  const birdBathBowl=cylinderMesh('birdbath-bowl',[.3,.91,-17.35],.55,.28,.16,palette.stone,22);
  const birdWater=new THREE.Mesh(new THREE.CircleGeometry(.42,24),palette.water); birdWater.rotation.x=-Math.PI/2; birdWater.position.set(.3,1,-17.35); root.add(birdWater);
  registerObstacle('birdbath-obstacle',birdBathBase,'garden','birdbath'); registerObstacle('birdbath-bowl-obstacle',birdBathBowl,'garden','birdbath');
  addInterest('birdbath-watch','watch','Bird and insect activity at the bath',[.3,1.05,-17.35],'garden',{radius:1.25,utility:.88,object:birdBathBowl,tags:['birdwatch','water','outdoor']});

  // Low-poly grass blades add close-range parallax while remaining inexpensive.
  addInstancedGrass();
  function addInstancedGrass() {
    const geometry=new THREE.PlaneGeometry(.035,.22);
    geometry.translate(0,.11,0);
    const grass=new THREE.InstancedMesh(geometry,material(0x628557,1,0,{side:THREE.DoubleSide}),430);
    grass.name='garden-grass-blades'; grass.castShadow=false; grass.receiveShadow=true;
    const dummy=new THREE.Object3D();
    let seed=0x8271;
    const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
    let placed=0;
    while(placed<430) {
      const x=-12.4+random()*24.8, z=-19.55+random()*9.1;
      if((x>.6&&z>-14.2)||(x>-7.4&&x<7.3&&z>-18.3&&z<-13.1)) continue;
      dummy.position.set(x,.005,z); dummy.rotation.y=random()*Math.PI; const s=.65+random()*.8; dummy.scale.set(s,s,s); dummy.updateMatrix(); grass.setMatrixAt(placed++,dummy.matrix);
    }
    grass.instanceMatrix.needsUpdate=true; root.add(grass);
  }

  for(const [i,x,z,s] of [[0,-2.1,-18.5,.45],[1,-4.2,-12.2,.38],[2,7.3,-15.4,.52],[3,11.4,-14.9,.35]]) {
    const rock=sphereMesh(`garden-rock-${i}`,[x,.12*s,z],s,palette.stone,[1,.48,.75],root,12);
    registerObstacle(`garden-rock-obstacle-${i}`,rock,'garden','rock');
  }

  // -------------------------------------------------------------------------
  // Lighting and small atmospheric motions.
  // -------------------------------------------------------------------------

  const hemi=new THREE.HemisphereLight(0xbfd8e4,0x3e362c,1.55); hemi.name='ambient-sky-light'; root.add(hemi);
  const sun=new THREE.DirectionalLight(0xffe2b7,2.15); sun.name='garden-sun'; sun.position.set(-9,16,-13); sun.castShadow=true;
  sun.shadow.mapSize.set(1536,1536); sun.shadow.camera.left=-18; sun.shadow.camera.right=18; sun.shadow.camera.top=16; sun.shadow.camera.bottom=-22; sun.shadow.camera.near=1; sun.shadow.camera.far=45; sun.shadow.bias=-.00035; root.add(sun);
  for(const [id,pos,color,power,range] of [
    ['living-lamp',[-5.2,2.55,-5.8],0xffc98a,18,8],
    ['kitchen-light',[6.8,2.72,-4.3],0xffe6bd,24,9],
    ['hall-light',[7.2,2.65,6.1],0xffd8a5,14,7],
    ['bath-light',[3.3,2.72,5.2],0xdcecff,15,6],
  ]) {
    const shade=cylinderMesh(`${id}-shade`,pos,.22,.43,.26,palette.warmGlow,20); shade.rotation.x=Math.PI;
    const light=new THREE.PointLight(color,power,range,2); light.name=id; light.position.set(pos[0],pos[1]-.12,pos[2]); light.castShadow=false; root.add(light);
    animated.push({type:'lamp',light,base:power,phase:power*.31});
  }

  // -------------------------------------------------------------------------
  // Public API and simulation updates.
  // -------------------------------------------------------------------------

  /**
   * Returns the highest eligible surface at X/Z.  Pass a reference Y to reject
   * surfaces more than maxStep above the caller (essential beneath tables).
   * The returned record includes both `y` and `height`, plus the source surface.
   */
  function sampleSurface(x, z, referenceY=Infinity, maxStep=Infinity) {
    let options={};
    if(referenceY && typeof referenceY==='object') {
      options=referenceY;
      referenceY=options.referenceY ?? options.fromY ?? Infinity;
      maxStep=options.maxStep ?? Infinity;
    }
    let best=null, bestY=-Infinity;
    const ceiling=Number.isFinite(referenceY) ? referenceY+maxStep : Infinity;
    const minY=options.minY ?? -Infinity;
    for(const surface of surfaces) {
      if(!surface.walkable || x<surface.minX || x>surface.maxX || z<surface.minZ || z>surface.maxZ) continue;
      const y=surface.heightAt ? surface.heightAt(x,z) : surface.y;
      if(y>ceiling+.001 || y<minY-.001) continue;
      if(y>bestY || (Math.abs(y-bestY)<1e-5 && surface.priority>(best?.priority ?? -Infinity))) { best=surface; bestY=y; }
    }
    if(!best) return null;
    return {
      y:bestY,
      height:bestY,
      normal:best.normal,
      walkable:best.walkable,
      climbable:best.climbable,
      width:Math.min(best.maxX-best.minX,best.maxZ-best.minZ),
      narrowness:Math.max(0,Math.min(1,1-(Math.min(best.maxX-best.minX,best.maxZ-best.minZ)-.08)/.52)),
      friction:best.friction,
      softness:best.softness,
      room:best.room,
      type:best.type,
      surface:best,
      valueOf(){return bestY;},
      [Symbol.toPrimitive](){return bestY;},
    };
  }

  function roomAt(position, zValue) {
    const x=typeof position==='number'?position:(position?.x ?? 0);
    const z=typeof position==='number'?(zValue ?? 0):(position?.z ?? 0);
    for(const room of roomZones) if(x>=room.minX&&x<=room.maxX&&z>=room.minZ&&z<=room.maxZ) return room.id;
    if(x>=-13&&x<=13&&z>=-10&&z<=10) return 'hall-stairs';
    return 'outside';
  }

  function toggleDoor(id='garden-door', force) {
    const door=doors.get(id);
    if(!door) return false;
    door.open=typeof force==='boolean'?force:!door.open;
    door.target=door.open?1:0;
    door.interactable.state.open=door.open;
    return door.open;
  }

  function refill(kind='food') {
    const state=resources[kind];
    if(!state || (kind!=='food'&&kind!=='water')) return false;
    state.fullness=1;
    state.lastRefill=performanceNow();
    state.fill.visible=true;
    state.fill.scale.setScalar(1);
    const item=interactables.find(entry=>entry.id===`${kind}-bowl`);
    if(item) item.state.fullness=1;
    return true;
  }

  function cleanLitter() {
    const state=resources.litter;
    if(!state) return false;
    state.cleanliness=1;
    state.lastClean=performanceNow();
    for(const clump of state.clumps) clump.visible=false;
    state.fill.material.color.setHex(0xc9c0aa);
    const item=interactables.find(entry=>entry.id==='litter-box');
    if(item) item.state.cleanliness=1;
    return true;
  }

  function performanceNow() {
    return typeof performance!=='undefined'?performance.now()/1000:Date.now()/1000;
  }

  function update(dt, time=performanceNow()) {
    const safeDt=Math.min(Math.max(dt||0,0),.1);
    for(const door of doors.values()) {
      door.amount += (door.target-door.amount)*(1-Math.exp(-9*safeDt));
      const eased=door.amount*door.amount*(3-2*door.amount);
      door.pivot.rotation.y=door.closedRotation+door.direction*eased*Math.PI*.48;
      door.pivot.updateWorldMatrix(true,true);
      tmpBox.setFromObject(door.pivot);
      door.obstacle.min.copy(tmpBox.min); door.obstacle.max.copy(tmpBox.max);
    }
    if(resources.water) {
      resources.water.fill.position.y=resources.water.baseY+Math.sin(time*2.2)*.0015;
      resources.water.fill.material.opacity=.68+Math.sin(time*1.37)*.035;
    }
    for(const item of animated) {
      if(item.type==='lamp') item.light.intensity=item.base*(.992+Math.sin(time*7.3+item.phase)*.008);
      else if(item.type==='sway') item.object.rotation.z=item.base+Math.sin(time*.73+item.phase)*item.amplitude;
    }
    // Resource visuals follow state continuously, allowing needs logic to alter
    // fullness/cleanliness directly without knowing mesh details.
    for(const kind of ['food','water']) {
      const state=resources[kind];
      if(!state) continue;
      state.fullness=Math.max(0,Math.min(1,state.fullness));
      state.fill.visible=state.fullness>.015;
      state.fill.scale.setScalar(.48+.52*Math.sqrt(Math.max(0,state.fullness)));
      const item=interactables.find(entry=>entry.id===`${kind}-bowl`);
      if(item) item.state.fullness=state.fullness;
    }
    if(resources.litter) {
      resources.litter.cleanliness=Math.max(0,Math.min(1,resources.litter.cleanliness));
      const dirt=1-resources.litter.cleanliness;
      resources.litter.clumps.forEach((clump,index)=>clump.visible=dirt>(index+1)*.2);
      const item=interactables.find(entry=>entry.id==='litter-box');
      if(item) item.state.cleanliness=resources.litter.cleanliness;
    }
  }

  function getPerceptionObjects() {
    const result=[];
    for(const point of interestPoints) {
      if(!point.available) continue;
      result.push({id:point.id,kind:point.type,type:point.type,label:point.label,room:point.room,position:point.position,radius:point.radius,utility:point.utility,tags:point.tags,state:point.state,source:point});
    }
    for(const item of interactables) {
      if(!item.enabled) continue;
      result.push({id:item.id,kind:item.kind,type:item.kind,label:item.label,room:item.room,position:item.position,radius:item.radius,tags:['interactable'],state:item.state,source:item});
    }
    return result;
  }

  function dispose() {
    root.traverse(object=>{
      object.geometry?.dispose?.();
      if(Array.isArray(object.material)) object.material.forEach(mat=>mat.dispose?.());
      else object.material?.dispose?.();
    });
    disposableTextures.forEach(texture=>texture.dispose());
    root.removeFromParent();
    obstacles.length=0; surfaces.length=0; interestPoints.length=0; interactables.length=0; animated.length=0; doors.clear();
  }

  root.userData.rooms=roomZones;
  root.userData.environmentScale='metres';
  root.userData.resources=resources;

  return {
    root,
    rooms:roomZones,
    resources,
    doors,
    obstacles,
    surfaces,
    interestPoints,
    interactables,
    sampleSurface,
    roomAt,
    toggleDoor,
    refill,
    cleanLitter,
    update,
    getPerceptionObjects,
    dispose,
  };
}

export default createEnvironment;
