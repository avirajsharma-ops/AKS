#!/bin/bash

#==============================================================================
# AKS (AI Knowledge System) - Production Deployment Script
# 
# This script sets up AKS on a fresh Ubuntu server with:
# - Docker & Docker Compose
# - MongoDB, Backend API, Frontend with Nginx
# - SSL certificates via Let's Encrypt
# - Firewall configuration
# - Auto-start on boot
#
# Usage:
#   ./deploy-production.sh --ssl --domain itsmira.cloud --email admin@itsmira.cloud
#
# Options:
#   --fresh     Clean install (removes existing containers and volumes)
#   --ssl       Install SSL certificates with Let's Encrypt
#   --no-ssl    Skip SSL setup (HTTP only)
#   --domain    Specify domain (default: itsmira.cloud)
#   --email     Email for SSL certificate notifications
#   --help      Show this help message
#==============================================================================

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m'

# Configuration
DOMAIN="itsmira.cloud"
EMAIL=""
FRESH_INSTALL=false
SETUP_SSL=true
SKIP_SSL=false
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Logging
log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warning() { echo -e "${YELLOW}[WARNING]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
log_step() { echo -e "\n${PURPLE}==>${NC} ${CYAN}$1${NC}"; }

show_banner() {
    echo -e "${PURPLE}"
    echo "╔═══════════════════════════════════════════════════════════════╗"
    echo "║                                                               ║"
    echo "║     █████╗ ██╗  ██╗███████╗                                  ║"
    echo "║    ██╔══██╗██║ ██╔╝██╔════╝                                  ║"
    echo "║    ███████║█████╔╝ ███████╗                                  ║"
    echo "║    ██╔══██║██╔═██╗ ╚════██║                                  ║"
    echo "║    ██║  ██║██║  ██╗███████║                                  ║"
    echo "║    ╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝                                  ║"
    echo "║                                                               ║"
    echo "║           AI Knowledge System - Production Deploy             ║"
    echo "║                                                               ║"
    echo "╚═══════════════════════════════════════════════════════════════╝"
    echo -e "${NC}"
}

show_help() {
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  --fresh         Clean install (removes existing containers and volumes)"
    echo "  --ssl           Install SSL certificates with Let's Encrypt (default)"
    echo "  --no-ssl        Skip SSL setup (HTTP only)"
    echo "  --domain NAME   Specify domain (default: itsmira.cloud)"
    echo "  --email EMAIL   Email for SSL certificate notifications"
    echo "  --help          Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0 --ssl --domain itsmira.cloud --email admin@itsmira.cloud"
    echo "  $0 --fresh --ssl"
    echo "  $0 --no-ssl"
}

parse_args() {
    while [[ $# -gt 0 ]]; do
        case $1 in
            --fresh) FRESH_INSTALL=true; shift ;;
            --ssl) SETUP_SSL=true; SKIP_SSL=false; shift ;;
            --no-ssl) SKIP_SSL=true; SETUP_SSL=false; shift ;;
            --domain) DOMAIN="$2"; shift 2 ;;
            --email) EMAIL="$2"; shift 2 ;;
            --help) show_help; exit 0 ;;
            *) log_error "Unknown option: $1"; show_help; exit 1 ;;
        esac
    done
}

check_root() {
    if [[ $EUID -ne 0 ]]; then
        log_error "This script must be run as root or with sudo"
        exit 1
    fi
}

install_dependencies() {
    log_step "Installing system dependencies..."
    
    apt-get update -y
    apt-get install -y \
        apt-transport-https \
        ca-certificates \
        curl \
        gnupg \
        lsb-release \
        software-properties-common \
        git \
        ufw \
        htop \
        wget \
        jq \
        openssl
    
    log_success "Dependencies installed"
}

install_docker() {
    log_step "Installing Docker..."
    
    if command -v docker &> /dev/null; then
        log_info "Docker already installed: $(docker --version)"
    else
        # Remove old versions
        apt-get remove -y docker docker-engine docker.io containerd runc 2>/dev/null || true
        
        # Add Docker GPG key
        install -m 0755 -d /etc/apt/keyrings
        curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
        chmod a+r /etc/apt/keyrings/docker.gpg
        
        # Add repository
        echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null
        
        # Install Docker
        apt-get update -y
        apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
        
        log_success "Docker installed"
    fi
    
    systemctl enable docker
    systemctl start docker
}

configure_firewall() {
    log_step "Configuring firewall..."
    
    ufw --force reset
    ufw default deny incoming
    ufw default allow outgoing
    ufw allow ssh
    ufw allow 80/tcp
    ufw allow 443/tcp
    ufw --force enable
    
    log_success "Firewall configured"
}

setup_ssl() {
    log_step "Setting up SSL certificates for $DOMAIN..."
    
    if [[ -z "$EMAIL" ]]; then
        EMAIL="admin@${DOMAIN}"
        log_warning "No email provided, using: $EMAIL"
    fi
    
    # Install certbot
    apt-get install -y certbot
    
    # Stop anything using port 80
    docker compose -f "$PROJECT_DIR/docker-compose.prod.yml" down 2>/dev/null || true
    
    # Get certificate
    certbot certonly \
        --standalone \
        --non-interactive \
        --agree-tos \
        --email "$EMAIL" \
        --domains "$DOMAIN" \
        || {
            log_error "Failed to get SSL certificate for $DOMAIN"
            log_info "Make sure your domain DNS points to this server's IP"
            log_info "Creating self-signed certificate as fallback..."
            create_self_signed_ssl
            return
        }
    
    # Copy certificates to docker ssl folder
    mkdir -p "$PROJECT_DIR/docker/ssl"
    cp "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" "$PROJECT_DIR/docker/ssl/"
    cp "/etc/letsencrypt/live/$DOMAIN/privkey.pem" "$PROJECT_DIR/docker/ssl/"
    chmod 600 "$PROJECT_DIR/docker/ssl/"*.pem
    
    # Setup auto-renewal
    (crontab -l 2>/dev/null | grep -v certbot; echo "0 3 * * * certbot renew --quiet --post-hook 'cp /etc/letsencrypt/live/$DOMAIN/*.pem $PROJECT_DIR/docker/ssl/ && docker compose -f $PROJECT_DIR/docker-compose.prod.yml restart frontend'") | crontab -
    
    log_success "SSL certificates installed"
}

create_self_signed_ssl() {
    log_step "Creating self-signed SSL certificates..."
    
    mkdir -p "$PROJECT_DIR/docker/ssl"
    
    openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
        -keyout "$PROJECT_DIR/docker/ssl/privkey.pem" \
        -out "$PROJECT_DIR/docker/ssl/fullchain.pem" \
        -subj "/CN=$DOMAIN/O=AKS/C=US" 2>/dev/null
    
    chmod 600 "$PROJECT_DIR/docker/ssl/"*.pem
    
    log_warning "Self-signed certificates created. Browser will show security warning."
}

create_env_file() {
    log_step "Setting up environment configuration..."
    
    ENV_FILE="$PROJECT_DIR/.env"
    
    if [[ -f "$ENV_FILE" ]]; then
        log_info "Using existing .env file"
        return
    fi
    
    # Generate secure passwords
    MONGO_PASS=$(openssl rand -base64 24 | tr -dc 'a-zA-Z0-9' | head -c 24)
    JWT_SEC=$(openssl rand -base64 48 | tr -dc 'a-zA-Z0-9' | head -c 48)
    JWT_REF=$(openssl rand -base64 48 | tr -dc 'a-zA-Z0-9' | head -c 48)
    
    # Create .env file
    cat > "$ENV_FILE" << EOF
# AKS Production Environment Configuration
# Generated on $(date)

# Domain
DOMAIN=$DOMAIN

# MongoDB
MONGO_USERNAME=admin
MONGO_PASSWORD=$MONGO_PASS

# JWT Secrets
JWT_SECRET=$JWT_SEC
JWT_REFRESH_SECRET=$JWT_REF

# API Keys - REPLACE THESE WITH YOUR ACTUAL KEYS
OPENAI_API_KEY=your-openai-api-key
DEEPGRAM_API_KEY=your-deepgram-api-key
ELEVENLABS_API_KEY=your-elevenlabs-api-key
ELEVENLABS_VOICE_ID=your-elevenlabs-voice-id
EOF
    
    chmod 600 "$ENV_FILE"
    log_success "Environment file created at $ENV_FILE"
    log_warning "IMPORTANT: Edit .env and add your API keys!"
}

create_directories() {
    log_step "Creating required directories..."
    
    mkdir -p "$PROJECT_DIR/docker/ssl"
    mkdir -p "$PROJECT_DIR/docker/nginx-logs"
    
    log_success "Directories created"
}

clean_install() {
    log_step "Performing clean install..."
    
    # Stop all containers
    docker compose -f "$PROJECT_DIR/docker-compose.prod.yml" down -v --remove-orphans 2>/dev/null || true
    
    # Remove any orphan containers
    docker stop $(docker ps -aq) 2>/dev/null || true
    docker rm $(docker ps -aq) 2>/dev/null || true
    
    # Prune system
    docker system prune -af 2>/dev/null || true
    docker volume prune -f 2>/dev/null || true
    
    log_success "Cleaned up old installation"
}

build_and_start() {
    log_step "Building and starting containers..."
    
    cd "$PROJECT_DIR"
    
    # Build images
    log_info "Building Docker images (this may take a few minutes)..."
    docker compose -f docker-compose.prod.yml build --no-cache
    
    # Start containers
    log_info "Starting containers..."
    docker compose -f docker-compose.prod.yml up -d
    
    # Wait for services
    log_info "Waiting for services to be healthy..."
    sleep 30
    
    # Show status
    docker compose -f docker-compose.prod.yml ps
    
    log_success "Containers started"
}

create_systemd_service() {
    log_step "Creating systemd service for auto-start..."
    
    cat > /etc/systemd/system/aks.service << EOF
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
TimeoutStartSec=0

[Install]
WantedBy=multi-user.target
EOF

    systemctl daemon-reload
    systemctl enable aks.service
    
    log_success "Systemd service created"
}

verify_deployment() {
    log_step "Verifying deployment..."
    
    sleep 5
    
    # Test HTTP
    HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "http://localhost/health" 2>/dev/null || echo "000")
    
    if [[ "$HTTP_STATUS" == "200" ]] || [[ "$HTTP_STATUS" == "301" ]]; then
        log_success "HTTP endpoint responding!"
    else
        log_warning "HTTP health check returned: $HTTP_STATUS"
    fi
    
    # Test HTTPS
    if [[ -f "$PROJECT_DIR/docker/ssl/fullchain.pem" ]]; then
        HTTPS_STATUS=$(curl -sk -o /dev/null -w "%{http_code}" --max-time 10 "https://localhost/health" 2>/dev/null || echo "000")
        if [[ "$HTTPS_STATUS" == "200" ]]; then
            log_success "HTTPS health check passed!"
        else
            log_warning "HTTPS health check returned: $HTTPS_STATUS"
        fi
    fi
    
    # Show logs if issues
    if [[ "$HTTP_STATUS" == "000" ]]; then
        log_info "Recent container logs:"
        docker compose -f "$PROJECT_DIR/docker-compose.prod.yml" logs --tail=30
    fi
}

show_completion() {
    echo ""
    echo -e "${GREEN}╔═══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║              🎉 DEPLOYMENT COMPLETE! 🎉                       ║${NC}"
    echo -e "${GREEN}╚═══════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    
    echo -e "Your AKS instance is live at: ${GREEN}https://$DOMAIN${NC}"
    
    echo ""
    echo -e "${YELLOW}IMPORTANT: Edit .env file and add your API keys:${NC}"
    echo -e "  ${CYAN}nano $PROJECT_DIR/.env${NC}"
    echo ""
    echo -e "Required API keys:"
    echo -e "  - OPENAI_API_KEY"
    echo -e "  - DEEPGRAM_API_KEY"
    echo -e "  - ELEVENLABS_API_KEY"
    echo ""
    echo -e "After updating .env, restart the services:"
    echo -e "  ${CYAN}docker compose -f docker-compose.prod.yml restart${NC}"
    echo ""
    echo -e "Useful commands:"
    echo -e "  ${YELLOW}docker compose -f docker-compose.prod.yml logs -f${NC}      - View logs"
    echo -e "  ${YELLOW}docker compose -f docker-compose.prod.yml ps${NC}           - Check status"
    echo -e "  ${YELLOW}docker compose -f docker-compose.prod.yml restart${NC}      - Restart"
    echo -e "  ${YELLOW}docker compose -f docker-compose.prod.yml down${NC}         - Stop"
    echo -e "  ${YELLOW}systemctl status aks${NC}                                   - Service status"
    echo ""
}

# Main execution
main() {
    show_banner
    parse_args "$@"
    check_root
    
    log_info "Domain: $DOMAIN"
    log_info "Fresh Install: $FRESH_INSTALL"
    log_info "Setup SSL: $SETUP_SSL"
    log_info "Project Directory: $PROJECT_DIR"
    
    # System setup
    install_dependencies
    install_docker
    configure_firewall
    
    # Clean install if requested
    if [[ "$FRESH_INSTALL" == true ]]; then
        clean_install
    fi
    
    # Create directories
    create_directories
    
    # SSL setup
    if [[ "$SETUP_SSL" == true ]]; then
        setup_ssl
    elif [[ "$SKIP_SSL" == true ]]; then
        log_warning "Skipping SSL - creating self-signed cert so nginx works"
        create_self_signed_ssl
    else
        # Default: setup SSL
        setup_ssl
    fi
    
    # Environment
    create_env_file
    
    # Build and start
    build_and_start
    
    # Post-deployment
    create_systemd_service
    verify_deployment
    
    show_completion
}

main "$@"
