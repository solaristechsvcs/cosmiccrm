// Only invoked by the GitHub deployment job. Credentials are GitHub Secrets.
export async function restartWisp({panelUrl,serverId,apiKey,fetchImpl=fetch}) {
  const url=new URL(panelUrl);
  if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new Error('WISP_PANEL_URL must be an HTTPS origin, such as https://panel.example.com.');
  if(!/^[a-zA-Z0-9-]+$/.test(serverId||''))throw new Error('Invalid Wisp server identifier.');
  if(!apiKey)throw new Error('WISP_API_KEY is required.');
  const response=await fetchImpl(url.origin+'/api/client/servers/'+serverId+'/power',{
    method:'POST',redirect:'error',signal:AbortSignal.timeout(30000),
    headers:{Authorization:'Bearer '+apiKey,Accept:'application/vnd.wisp.v1+json','Content-Type':'application/json'},
    body:JSON.stringify({signal:'restart'})
  });
  if(!response.ok)throw new Error('Wisp rejected the restart request (HTTP '+response.status+'). Check the client API key and server permissions.');
  return true;
}
if(process.argv[1]?.endsWith('restart-wisp.js')) {
  await restartWisp({panelUrl:process.env.WISP_PANEL_URL,serverId:process.env.WISP_SERVER_ID,apiKey:process.env.WISP_API_KEY});
  console.log('Wisp restart requested successfully. Check the server console for update and startup results.');
}
