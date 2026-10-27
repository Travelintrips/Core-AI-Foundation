# Nusa Karya VPS deploy

Target: `https://nusakarya.aicst.co.id`

This deployment is isolated from the AI Core production application. It installs only a static web root and one Nginx vhost.

## OpenClaw / DC VPS command

From the VPS repository checkout:

```bash
cd /opt/core-ai-foundation
git fetch origin
git checkout <verified-sha>
bash deploy/vps/nusa-karya/install.sh /opt/core-ai-foundation
```

The installer is intentionally fail-closed:

1. validates all static assets exist;
2. installs only `/var/www/nusa-karya`;
3. installs only `/etc/nginx/sites-available/nusa-karya`;
4. requires `nginx -t` to pass before reload;
5. verifies local Host-header health at `/healthz`;
6. attempts TLS only when Certbot is available;
7. exits non-zero until public HTTPS returns HTTP 200 and contains `Nusa Karya`.

A deployment must not be reported as PASS unless the final line contains:

```
NUSA_KARYA_PUBLIC_HTTPS=PASS domain=nusakarya.aicst.co.id
```
