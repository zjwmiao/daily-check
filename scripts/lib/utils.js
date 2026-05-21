export function parseArgs(argv) {
  const out = { _: [] };
  for (const a of argv) {
    if (a.startsWith('--')) {
      const [k, v] = a.replace(/^--/, '').split('=');
      out[k] = v ?? true;
    } else {
      out._.push(a);
    }
  }
  return out;
}

export function log(msg) {
  const ts = new Date().toISOString().slice(11, 19);
  console.error(`[${ts}] ${msg}`);
}

export async function readInput(args) {
  if (args.input) {
    const fs = await import('fs');
    return JSON.parse(fs.readFileSync(args.input, 'utf-8'));
  }

  const chunks = [];
  const stdin = process.stdin;
  
  if (stdin.readable) {
    stdin.resume();
    stdin.setEncoding('utf8');
    
    for await (const chunk of stdin) {
      chunks.push(chunk);
    }
    
    const input = chunks.join('').trim();
    if (input) {
      return JSON.parse(input);
    }
  }
  
  throw new Error('需要通过stdin或--input提供输入');
}