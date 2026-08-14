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
    const warp=(fbm(u,v,11,3,5)-.5)*.075;
    const pore=fbm(u*1,v,29,16,3);
    const grain=Math.sin((u+warp)*Math.PI*38+Math.sin(v*Math.PI*8)*.32)*.5+.5;
    const fine=Math.sin((u+warp*.35)*Math.PI*146)*.5+.5;
    const knotNoise=fbm(u,v,91,2,3);
    const knot=clamp((knotNoise-.73)*4.2);
    const height=clamp(.38+grain*.25+fine*.08-pore*.08-knot*.16);
    const value=clamp(.78+grain*.16+fine*.035-knot*.25+(pore-.5)*.08);
    return {height,albedo:[.47*value,.285*value,.16*value],roughness:clamp(.58+(pore-.5)*.2+knot*.12),ao:clamp(.92-(1-height)*.18)};
  },
  fabric(u,v){
    const count=96;
    const xThread=Math.pow(.5+.5*Math.cos(u*Math.PI*2*count),7);
    const yThread=Math.pow(.5+.5*Math.cos(v*Math.PI*2*count),7);
    const over=((Math.floor(u*count)+Math.floor(v*count))&1)===0;
    const weave=over?xThread*.72+yThread*.38:yThread*.72+xThread*.38;
    const irregular=(fbm(u,v,141,8,4)-.5)*.16;
    const height=clamp(.32+weave*.55+irregular);
    const value=clamp(.82+weave*.09+irregular*.28);
    return {height,albedo:[.29*value,.325*value,.27*value],roughness:clamp(.88-irregular*.25-weave*.035),ao:clamp(.82+height*.16)};
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
    const value=clamp(.58+(height-.5)*.36+(moist-.5)*.12);
    return {height,albedo:[.23*value,.16*value,.105*value],roughness:clamp(.9-moist*.12-stone*.2),ao:clamp(.72+height*.25)};
  },
  grass(u,v){
    const base=fbm(u,v,401,5,6),fine=fbm(u,v,405,32,3);
    const blade=Math.pow(.5+.5*Math.sin((u+Math.sin(v*TAU*3)*.006)*TAU*72),9);
    const dry=clamp((fbm(u,v,419,3,4)-.62)*3.4);
    const height=clamp(.3+base*.34+blade*.22+fine*.08);
    const value=clamp(.67+(base-.5)*.24+blade*.08);
    return {height,albedo:[lerp(.12,.32,dry)*value,lerp(.31,.25,dry)*value,.075*value],roughness:clamp(.86+(fine-.5)*.12),ao:clamp(.76+height*.2)};
  },
  plaster(u,v){
    const broad=fbm(u,v,501,3,5),grain=fbm(u,v,507,40,3);
    const height=clamp(.42+broad*.22+grain*.22);
    const value=clamp(.9+(broad-.5)*.06+(grain-.5)*.025);
    return {height,albedo:[.73*value,.70*value,.65*value],roughness:clamp(.87+(grain-.5)*.09),ao:clamp(.91+height*.07)};
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
  const strength=name==='fabric'?7:name==='plaster'?2.2:name==='soil'?5:4;
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
