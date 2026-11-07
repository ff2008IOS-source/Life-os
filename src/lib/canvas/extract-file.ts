import "server-only";
import { Worker } from "node:worker_threads";
import { join } from "node:path";
export type ExtractedUnit = { page: number; text: string };
export type ExtractedFile = {
  units: ExtractedUnit[];
  pages: number;
  truncated: boolean;
};
/** Constant parser program; document bytes are data, never evaluated code. No network or filesystem document reads. */
const program = String.raw`
const{parentPort,workerData}=require('node:worker_threads');const{pathToFileURL}=require('node:url');
(async()=>{let units=[],pages=0,truncated=false,total=0;const bytes=new Uint8Array(workerData.bytes);const add=(page,text)=>{text=text.replace(/\u0000/g,'').trim();if(!text)return;if(total+text.length>200000){text=text.slice(0,Math.max(0,200000-total));truncated=true;}if(text){units.push({page,text});total+=text.length;}};
const head=new TextDecoder().decode(bytes.slice(0,8));
if(head.startsWith('%PDF-')){const{getDocumentProxy}=await import(pathToFileURL(workerData.pdf).href);const pdf=await getDocumentProxy(bytes,{isEvalSupported:false,maxImageSize:0,disableFontFace:true,useSystemFonts:false,useWorkerFetch:false,isOffscreenCanvasSupported:false,isImageDecoderSupported:false,stopAtErrors:true});try{pages=pdf.numPages;if(pages>150)throw Error('page_limit');for(let i=1;i<=pages;i++){const page=await pdf.getPage(i);const data=await page.getTextContent();add(i,data.items.map(x=>x.str??'').join(' '));page.cleanup();if(total>=200000){truncated=i<pages;break;}}}finally{await pdf.cleanup?.();}}
else if(bytes[0]===80&&bytes[1]===75){const{unzipSync,strFromU8}=await import(pathToFileURL(workerData.zip).href);let declared=0;const zip=unzipSync(bytes,{filter:file=>{if(!/^(ppt\/slides\/slide\d+\.xml|word\/document\.xml)$/.test(file.name))return false;declared+=file.originalSize;if(file.originalSize>4000000||declared>20000000)throw Error('archive_limit');return true;}});const names=Object.keys(zip).sort((a,b)=>Number(a.match(/slide(\d+)/)?.[1]??0)-Number(b.match(/slide(\d+)/)?.[1]??0));if(!names.length)throw Error('unsupported');if(names.length>150)throw Error('page_limit');pages=names.length;for(let i=0;i<names.length;i++){const xml=strFromU8(zip[names[i]]);if(/<!DOCTYPE|<!ENTITY/i.test(xml))throw Error('unsupported');add(i+1,[...xml.matchAll(/<(?:a|w):t(?:\s[^>]*)?>([\s\S]*?)<\/(?:a|w):t>/g)].map(m=>m[1].replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'")).join(' '));}}
else if(workerData.mime.startsWith('text/')){pages=1;add(1,new TextDecoder().decode(bytes));}
else throw Error('unsupported');parentPort.postMessage({ok:true,result:{units,pages,truncated}});
})().catch(e=>parentPort.postMessage({ok:false,error:['page_limit','archive_limit','unsupported'].includes(e.message)?e.message:['ERR_MODULE_NOT_FOUND','MODULE_NOT_FOUND','ERR_INVALID_ARG_TYPE'].includes(e.code)?e.code:'parse_failed'}));`;
export async function extractCanvasFile(
  bytes: Uint8Array,
  mime: string,
  timeout = 15000,
): Promise<ExtractedFile> {
  if (bytes.byteLength > 12 * 1024 * 1024) throw Error("file_limit");
  const worker = new Worker(program, {
    eval: true,
    env: {},
    execArgv: [],
    workerData: {
      bytes,
      pdf: join(process.cwd(), "node_modules/unpdf/dist/index.mjs"),
      zip: join(process.cwd(), "node_modules/fflate/lib/node.cjs"),
      mime,
    },
    resourceLimits: {
      maxOldGenerationSizeMb: 128,
      maxYoungGenerationSizeMb: 16,
      stackSizeMb: 8,
    },
    stdout: true,
    stderr: true,
  });
  // Parser diagnostics can contain document text; do not forward them to logs.
  worker.stdout?.resume();
  worker.stderr?.resume();
  return new Promise((resolve, reject) => {
    let settled = false;
    const end = (error?: string, result?: ExtractedFile) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      if (error) reject(Error(error));
      else resolve(result!);
    };
    const timer = setTimeout(() => end("parse_timeout"), timeout);
    worker.on("message", (m) =>
      m.ok ? end(undefined, m.result) : end(m.error),
    );
    worker.on("error", (e: Error & { code?: string }) =>
      end(
        e.code === "ERR_WORKER_OUT_OF_MEMORY"
          ? "parse_memory_limit"
          : "parse_worker_failed",
      ),
    );
    worker.on("exit", () => {
      if (!settled) end("parse_failed");
    });
  });
}
export function chunkDocument(units: ExtractedUnit[]) {
  const chunks: { index: number; page: number; text: string }[] = [];
  for (const unit of units) {
    for (let start = 0; start < unit.text.length; start += 1100) {
      chunks.push({
        index: chunks.length,
        page: unit.page,
        text: unit.text.slice(start, start + 1400),
      });
      if (chunks.length >= 200) return chunks;
    }
  }
  return chunks;
}
