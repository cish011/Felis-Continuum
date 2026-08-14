import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const output = resolve(here, '..', 'build');
const size = 256;
const pixels = new Uint8Array(size * size * 4);

const clamp = value => Math.max(0, Math.min(1, value));
const mix = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

function ellipse(x, y, cx, cy, rx, ry) {
  return Math.hypot((x - cx) / rx, (y - cy) / ry);
}

function triangleSdf(px, py, ax, ay, bx, by, cx, cy) {
  const sign = (x1,y1,x2,y2,x3,y3) => (x1-x3)*(y2-y3)-(x2-x3)*(y1-y3);
  const d1=sign(px,py,ax,ay,bx,by), d2=sign(px,py,bx,by,cx,cy), d3=sign(px,py,cx,cy,ax,ay);
  return !((d1<0||d2<0||d3<0)&&(d1>0||d2>0||d3>0));
}

for (let y = 0; y < size; y++) {
  for (let x = 0; x < size; x++) {
    const nx = x / (size - 1), ny = y / (size - 1);
    const radial = clamp(1 - Math.hypot(nx - .42, ny - .34) * 1.15);
    let r = mix(10, 35, radial), g = mix(16, 48, radial), b = mix(18, 43, radial);
    const head = ellipse(x,y,128,139,69,62);
    const leftEar = triangleSdf(x,y,68,116,78,47,117,91);
    const rightEar = triangleSdf(x,y,139,91,181,47,189,119);
    const cat = Math.min(head, leftEar ? .83 : 2, rightEar ? .83 : 2);
    const edge = 1 - smooth(.90, 1.02, cat);
    if (edge > 0) {
      r = mix(r, 205, edge); g = mix(g, 226, edge); b = mix(b, 156, edge);
      const stripe = Math.sin((x - 128) * .105 + Math.abs(y - 120) * .04) * .5 + .5;
      if (head < .94 && y < 132) {
        const mask = smooth(.52,.9,stripe) * (1-smooth(.55,.95,Math.abs(x-128)/70)) * .18;
        r*=1-mask; g*=1-mask; b*=1-mask;
      }
    }
    const eyeL = ellipse(x,y,101,135,12,7), eyeR = ellipse(x,y,155,135,12,7);
    if (eyeL < 1 || eyeR < 1) { r=70; g=82; b=55; }
    const pupilL = ellipse(x,y,101,135,2.1,7), pupilR = ellipse(x,y,155,135,2.1,7);
    if (pupilL < 1 || pupilR < 1) { r=6; g=10; b=9; }
    const nose = triangleSdf(x,y,122,158,134,158,128,165);
    if (nose) { r=72; g=55; b=51; }
    const vignette = smooth(.62,.98,Math.hypot(nx-.5,ny-.5)*1.4);
    r*=1-vignette*.32; g*=1-vignette*.32; b*=1-vignette*.32;
    const index=(y*size+x)*4;
    pixels[index]=Math.round(r); pixels[index+1]=Math.round(g); pixels[index+2]=Math.round(b); pixels[index+3]=255;
  }
}

const crcTable = new Uint32Array(256);
for (let n=0;n<256;n++) { let c=n; for(let k=0;k<8;k++) c=(c&1)?0xedb88320^(c>>>1):c>>>1; crcTable[n]=c>>>0; }
function crc32(bytes) { let c=0xffffffff; for(const byte of bytes)c=crcTable[(c^byte)&255]^(c>>>8); return (c^0xffffffff)>>>0; }
function u32(value) { const out=Buffer.alloc(4); out.writeUInt32BE(value>>>0); return out; }
function chunk(type,data) { const name=Buffer.from(type); return Buffer.concat([u32(data.length),name,data,u32(crc32(Buffer.concat([name,data])))]); }

const rows=Buffer.alloc((size*4+1)*size);
for(let y=0;y<size;y++) { const row=y*(size*4+1); rows[row]=0; Buffer.from(pixels.buffer,y*size*4,size*4).copy(rows,row+1); }
const ihdr=Buffer.alloc(13); ihdr.writeUInt32BE(size,0); ihdr.writeUInt32BE(size,4); ihdr[8]=8; ihdr[9]=6;
const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(rows,{level:9})),chunk('IEND',Buffer.alloc(0))]);
const header=Buffer.alloc(22); header.writeUInt16LE(0,0); header.writeUInt16LE(1,2); header.writeUInt16LE(1,4); header[6]=0; header[7]=0; header[8]=0; header[9]=0; header.writeUInt16LE(1,10); header.writeUInt16LE(32,12); header.writeUInt32LE(png.length,14); header.writeUInt32LE(22,18);
mkdirSync(output,{recursive:true});
writeFileSync(resolve(output,'icon.png'),png);
writeFileSync(resolve(output,'icon.ico'),Buffer.concat([header,png]));
console.log('Generated Felis Continuum application icons.');
