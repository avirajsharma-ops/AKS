# AKS Production Deployment

## Quick Deploy (One Command)

```bash
git clone https://github.com/YOUR_USERNAME/AKS.git /var/www/aks
cd /var/www/aks
chmod +x deploy-production.sh
./deploy-production.sh --fresh --ssl --domain itsmira.cloud --email admin@itsmira.cloud
```

## Deployment Options

| Option | Description |
|--------|-------------|
| `--fresh` | Clean install (removes existing containers/volumes) |
| `--ssl` | Install Let's Encrypt SSL certificates |
| `--no-ssl` | HTTP only (no SSL) |
| `--domain NAME` | Specify domain (default: itsmira.cloud) |
| `--email EMAIL` | Email for SSL notifications |

## Examples

### Fresh install with SSL
```bash
./deploy-production.sh --fresh --ssl
```

### Update existing deployment
```bash
git pull origin main
./deploy-production.sh --ssl
```

### HTTP only (no SSL)
```bash
./deploy-production.sh --fresh --no-ssl
```

## Pre-requisites

- Ubuntu 20.04/22.04/24.04 LTS or Debian 11/12
- Root/sudo access
- Domain pointing to server IP
- Ports 80 and 443 open

## What the script does

1. **System Update** - Updates all system packages
2. **Install Dependencies** - curl, git, jq, ufw, fail2ban, etc.
3. **Install Docker** - Docker CE and Docker Compose plugin
4. **Configure Firewall** - UFW with SSH, HTTP, HTTPS
5. **SSL Setup** - Let's Encrypt certificates via Certbot
6. **Environment Config** - Creates `.env.prod` from example
7. **Nginx Config** - Reverse proxy with SSL, rate limiting
8. **Build & Start** - Docker containers for all services
9. **Systemd Service** - Auto-start on boot

## Post-Deployment

### Configure API Keys
Edit `/var/www/aks/.env.prod`:
```bash
nano /var/www/aks/.env.prod
```

Required keys:
- `OPENAI_API_KEY` - For AI responses
- `ELEVENLABS_API_KEY` - For text-to-speech
- `ELEVENLABS_VOICE_ID` - Voice selection

### Useful Commands
```bash
# View logs
docker compose -f docker-compose.prod.yml logs -f

# Check status
docker compose -f docker-compose.prod.yml ps

# Restart services
docker compose -f docker-compose.prod.yml restart

# Stop services
docker compose -f docker-compose.prod.yml down

# Service management
systemctl status aks
systemctl restart aks
```

## SSL Certificate Renewal

Certificates auto-renew via cron job. Manual renewal:
```bash
certbot renew
docker compose -f docker-compose.prod.yml restart nginx
```

## Troubleshooting

### Containers not starting
```bash
docker compose -f docker-compose.prod.yml logs
```

### SSL certificate issues
```bash
certbot certificates
certbot renew --dry-run
```

### Firewall issues
```bash
ufw status
ufw allow 80/tcp
ufw allow 443/tcp
```
