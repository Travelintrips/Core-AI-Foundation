// One DEV-only registry for phone-targeted browser commands.
// Only the explicit entries here may be dispatched by the admin UI/MCP.
// URLs must be HTTPS and stay on a known public site; never target PC workers.
export const DEV_PHONE_SITES = Object.freeze({
  github: Object.freeze({title:'Z Fold4 DEV OPEN_URL GitHub',url:'https://github.com/',label:'GitHub'}),
  hostinger: Object.freeze({title:'Z Fold4 DEV OPEN_URL Hostinger',url:'https://hpanel.hostinger.com/',label:'Hostinger hPanel'}),
  gcp: Object.freeze({title:'Z Fold4 DEV OPEN_URL GCP',url:'https://console.cloud.google.com/',label:'Google Cloud Console'}),
  'hostinger-vps': Object.freeze({title:'Z Fold4 DEV OPEN_URL Hostinger VPS',url:'https://hpanel.hostinger.com/vps',label:'Hostinger VPS'}),
  'gcp-compute': Object.freeze({title:'Z Fold4 DEV OPEN_URL GCP Compute',url:'https://console.cloud.google.com/compute/instances',label:'GCP VM instances'})
});
export const ACTION_TITLE_PREFIX='Z Fold4 DEV OPEN_URL ';
export function siteForTitle(title) {
  return Object.values(DEV_PHONE_SITES).find(s=>s.title===title)||null;
}
export function siteForUrl(url) {
  return Object.values(DEV_PHONE_SITES).find(s=>s.url===url)||null;
}
export function siteForKey(key) {
  return Object.hasOwn(DEV_PHONE_SITES,key)?DEV_PHONE_SITES[key]:null;
}
