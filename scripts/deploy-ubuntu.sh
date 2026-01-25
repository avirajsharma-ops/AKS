#!/bin/bash

# ============================================
# AKS Production Deployment Script
# For Ubuntu 24 LTS VPS
# ============================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if running as root
if [[ $EUID -eq 0 ]]; then
    print_error "Do not run this script as root. Run as a regular user with sudo privileges."
    exit 1
fi

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║           AKS Production Deployment Script               ║"
echo "║              Ubuntu 24 LTS VPS Setup                     ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""

# ============================================
# Step 1: System Update
# ============================================
print_status "Updating system packages..."
sudo apt update && sudo apt upgrade -y

# ============================================
# Step 2: Install Docker
# ============================================
if ! command -v docker &> /dev/null; then
    print_status "Installing Docker..."
    
    # Remove old versions
    sudo apt remove -y docker docker-engine docker.io containerd runc 2>/dev/null || true
    
    # Install dependencies
    sudo apt install -y \
        apt-transport-https \
        ca-certificates \
        curl \
        gnupg \
        lsb-release

    # Add Docker's official GPG key
    sudo install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    sudo chmod a+r /etc/apt/keyrings/docker.gpg

    # Add the repository
    echo \
      "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
      $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
      sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

    # Install Docker
    sudo apt update
    sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

    # Add current user to docker group
    sudo usermod -aG docker $USER
    
    print_success "Docker installed successfully"
else
    print_success "Docker is already installed"
fi

# ============================================
# Step 3: Install additional tools
# ============================================
print_status "Installing additional tools..."
sudo apt install -y \
    git \
    htop \
    curl \
    wget \
    ufw \
    fail2ban \
    certbot

# ============================================
# Step 4: Configure Firewall
# ============================================
print_status "Configuring firewall..."
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow ssh
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable
print_success "Firewall configured"

# ============================================
# Step 5: Configure Fail2Ban
# ============================================
print_status "Configuring Fail2Ban..."
sudo systemctl enable fail2ban
sudo systemctl start fail2ban
print_success "Fail2Ban configured"

# ============================================
# Step 6: Create project directory
# ============================================
PROJECT_DIR="/opt/aks"
print_status "Setting up project directory at $PROJECT_DIR..."

if [ ! -d "$PROJECT_DIR" ]; then
    sudo mkdir -p $PROJECT_DIR
    sudo chown $USER:$USER $PROJECT_DIR
fi

# ============================================
# Step 7: Setup SSL directory
# ============================================
print_status "Creating SSL directory..."
mkdir -p $PROJECT_DIR/docker/ssl
mkdir -p $PROJECT_DIR/docker/nginx-logs

# ============================================
# Step 8: Check for environment file
# ============================================
if [ ! -f "$PROJECT_DIR/.env.prod" ]; then
    print_warning "Environment file not found at $PROJECT_DIR/.env.prod"
    print_status "Please copy your .env.prod file to $PROJECT_DIR/.env.prod"
    print_status "Example: cp .env.prod.example $PROJECT_DIR/.env.prod"
fi

# ============================================
# Step 9: Create systemd service
# ============================================
print_status "Creating systemd service..."

sudo tee /etc/systemd/system/aks.service > /dev/null <<EOF
[Unit]
Description=AKS - AI Knowledge System
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=$PROJECT_DIR
ExecStart=/usr/bin/docker compose -f docker-compose.prod.yml up -d
ExecStop=/usr/bin/docker compose -f docker-compose.prod.yml down
User=$USER
Group=docker

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable aks.service
print_success "Systemd service created"

# ============================================
# Step 10: Create helper scripts
# ============================================
print_status "Creating helper scripts..."

# Deploy script
cat > $PROJECT_DIR/deploy.sh <<'EOF'
#!/bin/bash
cd /opt/aks
git pull origin main
docker compose -f docker-compose.prod.yml build --no-cache
docker compose -f docker-compose.prod.yml up -d
docker system prune -f
echo "Deployment complete!"
EOF
chmod +x $PROJECT_DIR/deploy.sh

# Logs script
cat > $PROJECT_DIR/logs.sh <<'EOF'
#!/bin/bash
docker compose -f docker-compose.prod.yml logs -f --tail=100 "$@"
EOF
chmod +x $PROJECT_DIR/logs.sh

# Status script
cat > $PROJECT_DIR/status.sh <<'EOF'
#!/bin/bash
echo "=== Container Status ==="
docker compose -f docker-compose.prod.yml ps
echo ""
echo "=== Resource Usage ==="
docker stats --no-stream
EOF
chmod +x $PROJECT_DIR/status.sh

# SSL setup script
cat > $PROJECT_DIR/setup-ssl.sh <<'EOF'
#!/bin/bash
# Run this after pointing your domain to this server

if [ -z "$1" ]; then
    echo "Usage: ./setup-ssl.sh your-domain.com [email@example.com]"
    exit 1
fi

DOMAIN=$1
EMAIL=${2:-"admin@$DOMAIN"}

# Stop nginx temporarily
docker compose -f docker-compose.prod.yml stop frontend

# Get certificate
sudo certbot certonly --standalone -d $DOMAIN --email $EMAIL --agree-tos --non-interactive

# Copy certificates
sudo cp /etc/letsencrypt/live/$DOMAIN/fullchain.pem /opt/aks/docker/ssl/
sudo cp /etc/letsencrypt/live/$DOMAIN/privkey.pem /opt/aks/docker/ssl/
sudo chown $USER:$USER /opt/aks/docker/ssl/*.pem

# Restart services
docker compose -f docker-compose.prod.yml up -d

echo "SSL configured for $DOMAIN"
echo "Don't forget to update nginx-site.prod.conf to enable HTTPS!"
EOF
chmod +x $PROJECT_DIR/setup-ssl.sh

print_success "Helper scripts created"

# ============================================
# Step 11: Setup log rotation
# ============================================
print_status "Configuring log rotation..."

sudo tee /etc/logrotate.d/aks > /dev/null <<EOF
$PROJECT_DIR/docker/nginx-logs/*.log {
    daily
    missingok
    rotate 14
    compress
    delaycompress
    notifempty
    create 0640 www-data adm
    sharedscripts
    postrotate
        docker exec aks-frontend nginx -s reopen 2>/dev/null || true
    endscript
}
EOF

print_success "Log rotation configured"

# ============================================
# Final Instructions
# ============================================
echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║              Setup Complete!                             ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""
print_success "Installation completed successfully!"
echo ""
echo "Next steps:"
echo ""
echo "1. ${YELLOW}Copy your project files to $PROJECT_DIR${NC}"
echo "   scp -r ./* user@your-server:$PROJECT_DIR/"
echo ""
echo "2. ${YELLOW}Create environment file:${NC}"
echo "   cp $PROJECT_DIR/.env.prod.example $PROJECT_DIR/.env.prod"
echo "   nano $PROJECT_DIR/.env.prod  # Edit with your values"
echo ""
echo "3. ${YELLOW}Start the application:${NC}"
echo "   cd $PROJECT_DIR"
echo "   docker compose -f docker-compose.prod.yml up -d --build"
echo ""
echo "4. ${YELLOW}(Optional) Setup SSL:${NC}"
echo "   ./setup-ssl.sh your-domain.com your@email.com"
echo ""
echo "Helper commands:"
echo "  ${BLUE}./deploy.sh${NC}    - Pull updates and redeploy"
echo "  ${BLUE}./logs.sh${NC}      - View container logs"
echo "  ${BLUE}./status.sh${NC}    - Check container status"
echo ""
print_warning "You may need to log out and back in for Docker group permissions to take effect"
