const fs = require('fs');
const https = require('https');

https.get('https://unpkg.com/@supabase/supabase-js@2', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    console.log("Status:", res.statusCode);
    console.log("Data snippet:", data.substring(0, 100));
  });
}).on('error', err => console.log("Error:", err));
