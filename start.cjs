// For Wisp Node eggs that only expose a MAIN_FILE field: set MAIN_FILE=start.cjs.
const { spawn } = require('node:child_process');
const child=spawn('bash',['scripts/start.sh'],{stdio:'inherit'});
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>child.kill(signal));
child.on('error',error=>{console.error(error.message);process.exit(1);});
child.on('exit',code=>process.exit(code??1));
