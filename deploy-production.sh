#!/bin/bash

#==============================================================================
# AKS (AI Knowledge System) - Production Deployment Script
# 
# Usage:
#   ./deploy-production.sh [OPTIONS]
#
# Options:
#   --fresh     Clean install (removes existing containers and volumes)
#   --ssl       Install/renew SSL certificates with Let's Encrypt
#   --no-ssl    Skip SSL setup (HTTP only)
#   --domain    Specify domain (default: itsmira.cloud)
#   --email     Email for SSL certificate notifications
#   --help      Show this help message
#
# Example:
#   ./deploy-production.sh --fresh --ssl --domain itsmira.cloud --email admin@itsmira.cloud
#==============================================================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Default configuration
DOMAIN="itsmira.cloud"
EMAIL=""
FRESH_INSTALL=false
SETUP_SSL=false
SKIP_SSL=false
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

log_step() {
    echo -e "\n${PURPLE}==>${NC} ${CYAN}$1${NC}"
}

# Show banner
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

# Show help
show_help() {
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  --fresh         Clean install (removes existing containers and volumes)"
    echo "  --ssl           Install/renew SSL certificates with Let's Encrypt"
    echo "  --no-ssl        Skip SSL setup (HTTP only)"
    echo "  --domain NAME   Specify domain (default: itsmira.cloud)"
    echo "  --email EMAIL   Email for SSL certificate notifications"
    echo "  --help          Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0 --fresh --ssl"
    echo "  $0 --ssl --domain itsmira.cloud --email admin@itsmira.cloud"
    echo "  $0 --fresh --no-ssl"
}

# Parse arguments
parse_args() {
    while [[ $# -gt 0 ]]; do
        case $1 in
            --fresh)
                FRESH_INSTALL=true
                shift
                ;;
            --ssl)
                SETUP_SSL=true
                shift
                ;;
            --no-ssl)
                SKIP_SSL=true
                shift
                ;;
            --domain)
                DOMAIN="$2"
                shift 2
                ;;
            --email)
                EMAIL="$2"
                shift 2
                ;;
            --help)
                show_help
                exit 0
                ;;
            *)
                log_error "Unknown option: $1"
                show_help
                exit 1
                ;;
        esac
    done
}

# Check if running as root or with sudo
check_root() {
    if [[ $EUID -ne 0 ]]; then
        log_error "This script must be run as root or with sudo"
        exit 1
    fi
}

# Detect OS
detect_os() {
    if [[ -f /etc/os-release ]]; then
        . /etc/os-release
        OS=$ID
        VERSION=$VERSION_ID
    else
        log_error "Cannot detect OS. /etc/os-release not found."
        exit 1
    fi
    
    log_info "Detected OS: $OS $VERSION"
    
    if [[ "$OS" != "ubuntu" && "$OS" != "debian" ]]; then
        log_warning "This script is optimized for Ubuntu/Debian. Proceed with caution."
    fi
}

# Update system packages
update_system() {
    log_step "Updating system packages..."
    
    apt-get update -y
    apt-get upgrade -y
    
    log_success "System packages updated"
}

# Install dependencies
install_dependencies() {
    log_step "Installing required dependencies..."
    
    apt-get install -y \
        apt-transport-https \
        ca-certificates \
        curl \
        gnupg \
        lsb-release \
        software-properties-common \
        git \
        ufw \
        fail2ban \
        htop \
        unzip \
        wget \
        jq
    
    log_success "Dependencies installed"
}

# Install Docker
install_docker() {
    log_step "Installing Docker..."
    
    # Check if Docker is already installed
    if command -v docker &> /dev/null; then
        log_info "Docker is already installed: $(docker --version)"
    else
        # Remove old versions
        apt-get remove -y docker docker-engine docker.io containerd runc 2>/dev/null || true
        
        # Add Docker's official GPG key
        install -m 0755 -d /etc/apt/keyrings
        curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
        chmod a+r /etc/apt/keyrings/docker.gpg
        
        # Add repository
        echo \
            "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
            $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
            tee /etc/apt/sources.list.d/docker.list > /dev/null
        
        # Install Docker
        apt-get update -y
        apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
        
        log_success "Docker installed: $(docker --version)"
    fi
    
    # Enable and start Docker
    systemctl enable docker
    systemctl start docker
    
    # Add current user to docker group (if not root)
    if [[ -n "$SUDO_USER" ]]; then
        usermod -aG docker "$SUDO_USER"
        log_info "Added $SUDO_USER to docker group"
    fi
}

# Install Certbot for SSL
install_certbot() {
    log_step "Installing Certbot for SSL certificates..."
    
    apt-get install -y certbot
    
    log_success "Certbot installed"
}

# Configure firewall
configure_firewall() {
    log_step "Configuring firewall..."
    
    # Reset UFW
    ufw --force reset
    
    # Default policies
    ufw default deny incoming
    ufw default allow outgoing
    
    # Allow SSH
    ufw allow ssh
    
    # Allow HTTP and HTTPS
    ufw allow 80/tcp
    ufw allow 443/tcp
    
    # Enable firewall
    ufw --force enable
    
    log_success "Firewall configured"
}

# Setup SSL with Let's Encrypt
setup_ssl() {
    log_step "Setting up SSL certificates..."
    
    if [[ -z "$EMAIL" ]]; then
        EMAIL="admin@${DOMAIN}"
        log_warning "No email provided, using: $EMAIL"
    fi
    
    # Create webroot directory
    mkdir -p /var/www/certbot
    
    # Stop any running containers that might be using port 80
    docker compose -f "$PROJECT_DIR/docker-compose.prod.yml" down 2>/dev/null || true
    
    # Get certificate
    certbot certonly \
        --standalone \
        --non-interactive \
        --agree-tos \
        --email "$EMAIL" \
        --domains "$DOMAIN" \
        --domains "www.$DOMAIN" \
        || {
            log_warning "Could not get certificate for www.$DOMAIN, trying just $DOMAIN"
            certbot certonly \
                --standalone \
                --non-interactive \
                --agree-tos \
                --email "$EMAIL" \
                --domains "$DOMAIN"
        }
    
    # Create SSL directory for nginx
    mkdir -p "$PROJECT_DIR/ssl"
    
    # Copy certificates
    if [[ -d "/etc/letsencrypt/live/$DOMAIN" ]]; then
        cp "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" "$PROJECT_DIR/ssl/"
        cp "/etc/letsencrypt/live/$DOMAIN/privkey.pem" "$PROJECT_DIR/ssl/"
        chmod 600 "$PROJECT_DIR/ssl/"*.pem
        log_success "SSL certificates installed"
    else
        log_error "SSL certificates not found at /etc/letsencrypt/live/$DOMAIN"
        exit 1
    fi
    
    # Setup auto-renewal cron job
    (crontab -l 2>/dev/null | grep -v certbot; echo "0 3 * * * certbot renew --quiet --post-hook 'docker compose -f $PROJECT_DIR/docker-compose.prod.yml restart nginx'") | crontab -
    log_info "SSL auto-renewal cron job configured"
}

# Create environment file
create_env_file() {
    log_step "Checking environment configuration..."
    
    ENV_FILE="$PROJECT_DIR/.env"
    
    # Check if .env already exists
    if [[ -f "$ENV_FILE" ]]; then
        log_success "Environment file .env found!"
        log_info "Using existing environment configuration"
        return
    fi
    
    log_warning "No .env file found. Please create one with your credentials."
    log_info "You can copy from backend/.env if available"
    
    # Check if backend/.env exists and copy it
    if [[ -f "$PROJECT_DIR/backend/.env" ]]; then
        cp "$PROJECT_DIR/backend/.env" "$ENV_FILE"
        log_success "Copied backend/.env to .env"
    fi
    
    log_success "Environment configuration complete"
}

# Create nginx configuration
create_nginx_config() {
    log_step "Creating Nginx configuration...""
    
    mkdir -p "$PROJECT_DIR/nginx"
    
    if [[ "$SETUP_SSL" == true && -f "$PROJECT_DIR/ssl/fullchain.pem" ]]; then
        # HTTPS configuration
        cat > "$PROJECT_DIR/nginx/nginx.conf" << 'NGINX_CONF'
events {
    worker_connections 1024;
}

http {
    include /etc/nginx/mime.types;
    default_type application/octet-stream;

    # Logging
    log_format main '$remote_addr - $remote_user [$time_local] "$request" '
                    '$status $body_bytes_sent "$http_referer" '
                    '"$http_user_agent" "$http_x_forwarded_for"';

    access_log /var/log/nginx/access.log main;
    error_log /var/log/nginx/error.log warn;

    # Performance
    sendfile on;
    tcp_nopush on;
    tcp_nodelay on;
    keepalive_timeout 65;
    types_hash_max_size 2048;

    # Gzip compression
    gzip on;
    gzip_vary on;
    gzip_proxied any;
    gzip_comp_level 6;
    gzip_types text/plain text/css text/xml application/json application/javascript application/xml+rss application/atom+xml image/svg+xml;

    # Rate limiting
    limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;
    limit_req_zone $binary_remote_addr zone=general:10m rate=30r/s;

    # Upstream servers
    upstream backend {
        server backend:5001;
        keepalive 32;
    }

    upstream frontend {
        server frontend:80;
        keepalive 32;
    }

    # HTTP - Redirect to HTTPS
    server {
        listen 80;
        listen [::]:80;
        server_name DOMAIN_PLACEHOLDER www.DOMAIN_PLACEHOLDER;

        location /.well-known/acme-challenge/ {
            root /var/www/certbot;
        }

        location / {
            return 301 https://$host$request_uri;
        }
    }

    # HTTPS
    server {
        listen 443 ssl http2;
        listen [::]:443 ssl http2;
        server_name DOMAIN_PLACEHOLDER www.DOMAIN_PLACEHOLDER;

        # SSL certificates
        ssl_certificate /etc/nginx/ssl/fullchain.pem;
        ssl_certificate_key /etc/nginx/ssl/privkey.pem;

        # SSL configuration
        ssl_session_timeout 1d;
        ssl_session_cache shared:SSL:50m;
        ssl_session_tickets off;

        # Modern SSL configuration
        ssl_protocols TLSv1.2 TLSv1.3;
        ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305:DHE-RSA-AES128-GCM-SHA256:DHE-RSA-AES256-GCM-SHA384;
        ssl_prefer_server_ciphers off;

        # HSTS
        add_header Strict-Transport-Security "max-age=63072000" always;

        # Security headers
        add_header X-Frame-Options "SAMEORIGIN" always;
        add_header X-Content-Type-Options "nosniff" always;
        add_header X-XSS-Protection "1; mode=block" always;
        add_header Referrer-Policy "strict-origin-when-cross-origin" always;

        # API routes
        location /api/ {
            limit_req zone=api burst=20 nodelay;

            proxy_pass http://backend;
            proxy_http_version 1.1;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_set_header Connection "";

            proxy_connect_timeout 60s;
            proxy_send_timeout 60s;
            proxy_read_timeout 60s;
        }

        # WebSocket
        location /socket.io/ {
            proxy_pass http://backend;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection "upgrade";
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;

            proxy_connect_timeout 7d;
            proxy_send_timeout 7d;
            proxy_read_timeout 7d;
        }

        # Frontend
        location / {
            limit_req zone=general burst=50 nodelay;

            proxy_pass http://frontend;
            proxy_http_version 1.1;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_set_header Connection "";
        }

        # Health check
        location /health {
            access_log off;
            return 200 "healthy\n";
            add_header Content-Type text/plain;
        }
    }
}
NGINX_CONF
    else
        # HTTP only configuration
        cat > "$PROJECT_DIR/nginx/nginx.conf" << 'NGINX_CONF'
events {
    worker_connections 1024;
}

http {
    include /etc/nginx/mime.types;
    default_type application/octet-stream;

    log_format main '$remote_addr - $remote_user [$time_local] "$request" '
                    '$status $body_bytes_sent "$http_referer" '
                    '"$http_user_agent"';

    access_log /var/log/nginx/access.log main;
    error_log /var/log/nginx/error.log warn;

    sendfile on;
    tcp_nopush on;
    tcp_nodelay on;
    keepalive_timeout 65;

    gzip on;
    gzip_vary on;
    gzip_proxied any;
    gzip_comp_level 6;
    gzip_types text/plain text/css text/xml application/json application/javascript;

    limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;
    limit_req_zone $binary_remote_addr zone=general:10m rate=30r/s;

    upstream backend {
        server backend:5001;
    }

    upstream frontend {
        server frontend:80;
    }

    server {
        listen 80;
        listen [::]:80;
        server_name DOMAIN_PLACEHOLDER www.DOMAIN_PLACEHOLDER;

        location /api/ {
            limit_req zone=api burst=20 nodelay;
            proxy_pass http://backend;
            proxy_http_version 1.1;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }

        location /socket.io/ {
            proxy_pass http://backend;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection "upgrade";
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_read_timeout 86400;
        }

        location / {
            limit_req zone=general burst=50 nodelay;
            proxy_pass http://frontend;
            proxy_http_version 1.1;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }

        location /health {
            access_log off;
            return 200 "healthy\n";
            add_header Content-Type text/plain;
        }
    }
}
NGINX_CONF
    fi
    
    # Replace domain placeholder
    sed -i "s|DOMAIN_PLACEHOLDER|$DOMAIN|g" "$PROJECT_DIR/nginx/nginx.conf"
    
    log_success "Nginx configuration created"
}

# Clean up existing installation
clean_install() {
    log_step "Performing fresh installation (removing existing data)..."
    
    cd "$PROJECT_DIR"
    
    # Stop and remove containers
    docker compose -f docker-compose.prod.yml down -v 2>/dev/null || true
    
    # Remove volumes
    docker volume rm aks_mongodb_data aks_redis_data 2>/dev/null || true
    
    # Prune unused resources
    docker system prune -f
    
    log_success "Cleaned up existing installation"
}

# Build and start containers
start_containers() {
    log_step "Building and starting Docker containers..."
    
    cd "$PROJECT_DIR"
    
    # Export environment variables for docker-compose
    if [[ -f "$PROJECT_DIR/.env.prod" ]]; then
        set -a
        source "$PROJECT_DIR/.env.prod"
        set +a
    fi
    
    # Build images
    log_info "Building Docker images..."
    docker compose -f docker-compose.prod.yml build --no-cache
    
    # Start containers
    log_info "Starting containers..."
    docker compose -f docker-compose.prod.yml up -d
    
    # Wait for services to be healthy
    log_info "Waiting for services to start..."
    sleep 10
    
    # Check container status
    docker compose -f docker-compose.prod.yml ps
    
    log_success "Containers started successfully"
}

# Verify deployment
verify_deployment() {
    log_step "Verifying deployment..."
    
    # Check if containers are running
    RUNNING_CONTAINERS=$(docker compose -f "$PROJECT_DIR/docker-compose.prod.yml" ps --format json 2>/dev/null | jq -r '.State' 2>/dev/null | grep -c "running" || echo "0")
    
    if [[ "$RUNNING_CONTAINERS" -lt 3 ]]; then
        log_warning "Some containers may not be running properly"
        docker compose -f "$PROJECT_DIR/docker-compose.prod.yml" ps
        docker compose -f "$PROJECT_DIR/docker-compose.prod.yml" logs --tail=50
    fi
    
    # Test health endpoint
    sleep 5
    
    if [[ "$SETUP_SSL" == true ]]; then
        HEALTH_URL="https://$DOMAIN/health"
    else
        HEALTH_URL="http://$DOMAIN/health"
    fi
    
    log_info "Testing health endpoint: $HEALTH_URL"
    
    HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$HEALTH_URL" 2>/dev/null || echo "000")
    
    if [[ "$HTTP_STATUS" == "200" ]]; then
        log_success "Health check passed!"
    else
        log_warning "Health check returned status: $HTTP_STATUS"
        log_info "This might be normal if DNS hasn't propagated yet."
    fi
}

# Create systemd service for auto-start
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
    
    log_success "Systemd service created and enabled"
}

# Show completion message
show_completion() {
    echo ""
    echo -e "${GREEN}╔═══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║                                                               ║${NC}"
    echo -e "${GREEN}║              🎉 DEPLOYMENT COMPLETE! 🎉                       ║${NC}"
    echo -e "${GREEN}║                                                               ║${NC}"
    echo -e "${GREEN}╚═══════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    
    if [[ "$SETUP_SSL" == true ]]; then
        echo -e "${CYAN}Your AKS instance is now live at:${NC}"
        echo -e "  🌐 ${GREEN}https://$DOMAIN${NC}"
    else
        echo -e "${CYAN}Your AKS instance is now live at:${NC}"
        echo -e "  🌐 ${GREEN}http://$DOMAIN${NC}"
    fi
    
    echo ""
    echo -e "${CYAN}Useful commands:${NC}"
    echo -e "  ${YELLOW}docker compose -f docker-compose.prod.yml logs -f${NC}     - View logs"
    echo -e "  ${YELLOW}docker compose -f docker-compose.prod.yml ps${NC}          - Check status"
    echo -e "  ${YELLOW}docker compose -f docker-compose.prod.yml restart${NC}     - Restart services"
    echo -e "  ${YELLOW}docker compose -f docker-compose.prod.yml down${NC}        - Stop services"
    echo ""
    echo -e "${CYAN}Service management:${NC}"
    echo -e "  ${YELLOW}systemctl status aks${NC}     - Check service status"
    echo -e "  ${YELLOW}systemctl restart aks${NC}    - Restart AKS"
    echo ""
    
    if [[ -f "$PROJECT_DIR/.env.prod" ]]; then
        source "$PROJECT_DIR/.env.prod"
        if [[ -z "$OPENAI_API_KEY" || "$OPENAI_API_KEY" == "your-openai-api-key" ]]; then
            echo -e "${YELLOW}⚠️  Remember to configure your API keys in .env.prod${NC}"
            echo ""
        fi
    fi
}

# Main execution
main() {
    show_banner
    parse_args "$@"
    check_root
    detect_os
    
    log_info "Domain: $DOMAIN"
    log_info "Fresh Install: $FRESH_INSTALL"
    log_info "Setup SSL: $SETUP_SSL"
    
    # System setup
    update_system
    install_dependencies
    install_docker
    
    # SSL setup
    if [[ "$SETUP_SSL" == true ]]; then
        install_certbot
        setup_ssl
    fi
    
    # Firewall
    configure_firewall
    
    # Clean install if requested
    if [[ "$FRESH_INSTALL" == true ]]; then
        clean_install
    fi
    
    # Configuration
    create_env_file
    create_nginx_config
    
    # Deploy
    start_containers
    
    # Post-deployment
    create_systemd_service
    verify_deployment
    
    show_completion
}

# Run main function
main "$@"
