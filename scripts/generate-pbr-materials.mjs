import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SIZE = 512;
const OUTPUT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'textures', 'pbr');
const clamp = (value,min=0,max=1)=>Math.max(min,Math.min(max,value));
const lerp = (a,b,t)=>a+(b-a)*t;
const smooth = t=>t*t*(3-2*t);
const fract = value=>value-Math.floor(value);

function hash(x,y,seed=0) {
  let h=Math.imul((x|0)^Math.imul(y|0,374761393)^seed,668265263);
  h=(h^(h>>>13));h=Math.imul(h,1274126177);return ((h^(h>>>16))>>>0)/4294967295;
}

function periodicNoise(u,v,cells,seed=0) {
  const x=u*cells,y=v*cells,ix=Math.floor(x),iy=Math.floor(y),fx=smooth(fract(x)),fy=smooth(fract(y));
  const wrap=n=>((n%cells)+cells)%cells;
  const a=hash(wrap(ix),wrap(iy),seed),b=hash(wrap(ix+1),wrap(iy),seed);
  const c=hash(wrap(ix),wrap(iy+1),seed),d=hash(wrap(ix+1),wrap(iy+1),seed);
  return lerp(lerp(a,b,fx),lerp(c,d,fx),fy);
}

function fbm(u,v,seed=0,baseCells=4,octaves=5) {
  let sum=0,total=0,amplitude=.5,cells=baseCells;
  for(let i=0;i<octaves;i++){sum+=periodicNoise(u,v,cells,seed+i*71)*amplitude;total+=amplitude;amplitude*=.5;cells*=2;}
  return sum/total;
}

function periodicDelta(a,b){let d=a-b;if(d>.5)d-=1;if(d<-.5)d+=1;return d;}

const materialDefinitions={
  oak(u,v){
    const broad=fbm(u,v,11,2,6);
    const curl=fbm(u,v,17,5,5);
    const pore=fbm(u,v,29,22,3);
    let knot=0,knotRing=0;
    for(let i=0;i<5;i++){
      const cx=hash(i,2,61),cy=hash(i,7,67);
      const dx=periodicDelta(u,cx),dy=periodicDelta(v,cy);
      const radius=.035+hash(i,11,71)*.034;
      const distance=Math.hypot(dx*2.55,dy);
      const influence=clamp(1-distance/radius);
      knot=Math.max(knot,influence);
      knotRing=Math.max(knotRing,influence*(.5+.5*Math.cos(distance/radius*TAU*5)));
    }
    // Several periodic, differently scaled distortions keep the fibres aligned
    // like real sawn timber without reducing the material to parallel stripes.
    const warp=(broad-.5)*.19+(curl-.5)*.055+Math.sin(v*TAU*2+(broad-.5)*3)*.014;
    const phase=(u+warp)*TAU*17+(curl-.5)*4.5+knotRing*2.2;
    const grain=.5+.5*Math.sin(phase);
    const fine=.5+.5*Math.sin((u+warp*.42)*TAU*71+(pore-.5)*2.4);
    const ray=Math.pow(.5+.5*Math.cos(v*TAU*53+(broad-.5)*5),14);
    const height=clamp(.4+grain*.19+fine*.055+ray*.035-pore*.06-knot*.12+knotRing*.08);
    const value=clamp(.82+grain*.12+fine*.025+ray*.035-knot*.2-knotRing*.07+(broad-.5)*.13);
    return {height,albedo:[.69*value,.49*value,.31*value],roughness:clamp(.56+(pore-.5)*.18+knot*.1-ray*.05),ao:clamp(.9-(1-height)*.14-knot*.04)};
  },
  fabric(u,v){
    const count=96;
    const xThread=Math.pow(.5+.5*Math.cos(u*Math.PI*2*count),7);
    const yThread=Math.pow(.5+.5*Math.cos(v*Math.PI*2*count),7);
    const over=((Math.floor(u*count)+Math.floor(v*count))&1)===0;
    const weave=over?xThread*.72+yThread*.38:yThread*.72+xThread*.38;
    const irregular=(fbm(u,v,141,8,4)-.5)*.16;
    const height=clamp(.32+weave*.55+irregular);
    const value=clamp(.88+weave*.07+irregular*.22);
    // Neutral fibres accept the palette tint cleanly; a pre-coloured green map
    // made blue, cream and rust upholstery both muddy and implausibly dark.
    return {height,albedo:[.84*value,.825*value,.79*value],roughness:clamp(.88-irregular*.25-weave*.035),ao:clamp(.82+height*.16)};
  },
  soil(u,v){
    let height=fbm(u,v,221,5,6)*.7+fbm(u,v,223,28,3)*.3;
    let stone=0;
    for(let i=0;i<26;i++){
      const cx=hash(i,2,301),cy=hash(i,7,302),radius=.008+hash(i,11,303)*.024;
      const dx=periodicDelta(u,cx),dy=periodicDelta(v,cy),d=Math.hypot(dx,dy);
      stone=Math.max(stone,clamp(1-d/radius));
    }
    height=clamp(height*.72+stone*.38);
    const moist=fbm(u,v,257,3,5);
    const value=clamp(.78+(height-.5)*.31+(moist-.5)*.1);
    return {height,albedo:[.42*value,.30*value,.205*value],roughness:clamp(.9-moist*.12-stone*.2),ao:clamp(.72+height*.25)};
  },
  grass(u,v){
    const base=fbm(u,v,401,4,6),fine=fbm(u,v,405,37,3);
    const thatch=Math.pow(fbm(u,v,411,67,2),3.2);
    const dry=clamp((fbm(u,v,419,3,4)-.62)*3.4);
    const height=clamp(.3+base*.37+fine*.14+thatch*.11);
    const value=clamp(.82+(base-.5)*.25+(fine-.5)*.07);
    // Close blades are geometry in the habitat.  The ground set therefore
    // supplies irregular turf/thatch detail instead of fake painted stripes.
    return {height,albedo:[lerp(.16,.39,dry)*value,lerp(.42,.31,dry)*value,lerp(.105,.075,dry)*value],roughness:clamp(.86+(fine-.5)*.12-thatch*.06),ao:clamp(.76+height*.2)};
  },
  plaster(u,v){
    const broad=fbm(u,v,501,3,5),grain=fbm(u,v,507,40,3);
    const height=clamp(.42+broad*.22+grain*.22);
    const value=clamp(.9+(broad-.5)*.06+(grain-.5)*.025);
    return {height,albedo:[.73*value,.70*value,.65*value],roughness:clamp(.87+(grain-.5)*.09),ao:clamp(.91+height*.07)};
  },
  tile(u,v){
    const cloud=fbm(u,v,601,4,5),grain=fbm(u,v,607,46,3);
    const speckle=Math.pow(fbm(u,v,613,91,2),5);
    const pit=clamp((fbm(u,v,617,73,2)-.72)*4.8);
    const hairline=Math.pow(.5+.5*Math.sin((u+v*.37+(cloud-.5)*.08)*TAU*23),18)*.018;
    const height=clamp(.51+(cloud-.5)*.09+(grain-.5)*.07+speckle*.035-pit*.12-hairline);
    const value=clamp(.92+(cloud-.5)*.075+(grain-.5)*.035-speckle*.025-pit*.055);
    return {height,albedo:[.87*value,.865*value,.84*value],roughness:clamp(.48+(grain-.5)*.11+pit*.16+hairline*1.8),ao:clamp(.96-pit*.1-hairline*.8)};
  },
};
const TAU=Math.PI*2;

function buildMaterial(name,sampler){
  const height=new Float32Array(SIZE*SIZE),roughness=new Uint8Array(SIZE*SIZE),ao=new Uint8Array(SIZE*SIZE),albedo=new Uint8Array(SIZE*SIZE*4);
  for(let y=0;y<SIZE;y++)for(let x=0;x<SIZE;x++){
    const index=y*SIZE+x,sample=sampler(x/SIZE,y/SIZE);height[index]=sample.height;roughness[index]=Math.round(clamp(sample.roughness)*255);ao[index]=Math.round(clamp(sample.ao)*255);
    const p=index*4;albedo[p]=Math.round(clamp(sample.albedo[0])*255);albedo[p+1]=Math.round(clamp(sample.albedo[1])*255);albedo[p+2]=Math.round(clamp(sample.albedo[2])*255);albedo[p+3]=255;
  }
  const normal=new Uint8Array(SIZE*SIZE*4);
  const strength=name==='fabric'?7:name==='plaster'?2.2:name==='tile'?1.8:name==='soil'?5:4;
  for(let y=0;y<SIZE;y++)for(let x=0;x<SIZE;x++){
    const left=height[y*SIZE+(x-1+SIZE)%SIZE],right=height[y*SIZE+(x+1)%SIZE];
    const down=height[((y-1+SIZE)%SIZE)*SIZE+x],up=height[((y+1)%SIZE)*SIZE+x];
    let nx=(left-right)*strength,ny=(down-up)*strength,nz=1;const length=Math.hypot(nx,ny,nz);nx/=length;ny/=length;nz/=length;
    const p=(y*SIZE+x)*4;normal[p]=Math.round((nx*.5+.5)*255);normal[p+1]=Math.round((ny*.5+.5)*255);normal[p+2]=Math.round((nz*.5+.5)*255);normal[p+3]=255;
  }
  writeFileSync(resolve(OUTPUT,`${name}-albedo.png`),encodePng(albedo,4));
  writeFileSync(resolve(OUTPUT,`${name}-normal.png`),encodePng(normal,4));
  writeFileSync(resolve(OUTPUT,`${name}-roughness.png`),encodePng(expandGray(roughness),4));
  writeFileSync(resolve(OUTPUT,`${name}-ao.png`),encodePng(expandGray(ao),4));
}

function expandGray(source){const out=new Uint8Array(source.length*4);for(let i=0;i<source.length;i++){const p=i*4;out[p]=out[p+1]=out[p+2]=source[i];out[p+3]=255;}return out;}
const crcTable=new Uint32Array(256);
for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;crcTable[n]=c>>>0;}
function crc32(bytes){let c=0xffffffff;for(const byte of bytes)c=crcTable[(c^byte)&255]^(c>>>8);return(c^0xffffffff)>>>0;}
function u32(value){const output=Buffer.alloc(4);output.writeUInt32BE(value>>>0);return output;}
function chunk(type,data){const name=Buffer.from(type);return Buffer.concat([u32(data.length),name,data,u32(crc32(Buffer.concat([name,data])))]);}
function encodePng(pixels,channels){const rows=Buffer.alloc((SIZE*channels+1)*SIZE);for(let y=0;y<SIZE;y++){const row=y*(SIZE*channels+1);rows[row]=0;Buffer.from(pixels.buffer,pixels.byteOffset+y*SIZE*channels,SIZE*channels).copy(rows,row+1);}const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(SIZE,0);ihdr.writeUInt32BE(SIZE,4);ihdr[8]=8;ihdr[9]=channels===4?6:0;return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(rows,{level:9})),chunk('IEND',Buffer.alloc(0))]);}

mkdirSync(OUTPUT,{recursive:true});
for(const [name,sampler] of Object.entries(materialDefinitions)){buildMaterial(name,sampler);process.stdout.write(`Generated ${name} PBR set.\n`);}
