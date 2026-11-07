// Verify the files Vercel receives, rather than the installed development tree.
import {
  readFileSync,
  mkdtempSync,
  mkdirSync,
  copyFileSync,
  rmSync,
} from "node:fs";
import { resolve, dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
const trace = resolve(
  ".next/server/app/api/internal/canvas/documents/route.js.nft.json",
);
const files = JSON.parse(readFileSync(trace, "utf8")).files;
const bundle = mkdtempSync(join(tmpdir(), "lifeos-parser-bundle-"));
try {
  for (const relative of files) {
    const source = resolve(dirname(trace), relative),
      match = source.match(/\/node_modules\/(unpdf|fflate)\/(.+)$/);
    if (!match) continue;
    const target = join(bundle, "node_modules", match[1], match[2]);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(source, target);
  }
  const program = String.raw`
 import {getDocumentProxy}from './node_modules/unpdf/dist/index.mjs';
 const content='BT /F1 12 Tf 72 720 Td (Canvas bundle smoke) Tj ET';
 let pdf='%PDF-1.4\n',offsets=[0];
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', '<< /Length '+content.length+' >>\nstream\n'+content+'\nendstream'];
 objects.forEach((o,i)=>{offsets.push(pdf.length);pdf+=(i+1)+' 0 obj\n'+o+'\nendobj\n'});
 const at=pdf.length;pdf+='xref\n0 6\n0000000000 65535 f \n'+offsets.slice(1).map(x=>String(x).padStart(10,'0')+' 00000 n \n').join('')+'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n'+at+'\n%%EOF';
 const p=await getDocumentProxy(new TextEncoder().encode(pdf),{isEvalSupported:false,useWorkerFetch:false,disableFontFace:true,useSystemFonts:false});
 const page=await p.getPage(1);const data=await page.getTextContent();if(!data.items.some(x=>x.str.includes('Canvas bundle smoke')))throw Error('Synthetic PDF text is missing');await p.cleanup();process.stdout.write('Traced PDF parser extracted synthetic text.\n');
 `;
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", program],
    {
      cwd: bundle,
      timeout: 20000,
      maxBuffer: 1024 * 1024,
      env: { PATH: process.env.PATH },
    },
  );
  if (result.status !== 0)
    throw Error(
      "Traced parser failed: " + String(result.stderr).slice(0, 1800),
    );
  process.stdout.write(result.stdout);
} finally {
  rmSync(bundle, { recursive: true, force: true });
}
