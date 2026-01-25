#!/bin/bash

#==============================================================================
# AKS (AI Knowledge System) - Simple Production Deployment
# 
# Usage:
#   ./deploy.sh              # Normal deployment
#   ./deploy.sh --fresh      # Clean install (removes everything)
#   ./deploy.sh --rebuild    # Rebuild and restart
#==============================================================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR"

log() { echo -e "${BLUE}[INFO]${NC} $1"; }
success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARNING]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; }

echo -e "${GREEN}"
echo "╔═══════════════════════════════════════════════════════════╗"
echo "║           AKS - AI Knowledge System Deploy                ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo -e "${NC}"

# Parse args
FRESH=false
REBUILD=false
while [[ $# -gt 0 ]]; do
    case $1 in
        --fresh) FRESH=true; shift ;;
        --rebuild) REBUILD=true; shift ;;
        *) shift ;;
    esac
done

# Check for .env file
if [[ ! -f ".env" ]]; then
    warn "No .env file found!"
    if [[ -f ".env.example" ]]; then
        log "Copying .env.example to .env"
        cp .env.example .env
        warn "Please edit .env with your API keys!"
    else
        error "Please create a .env file with your configuration"
        echo ""
        echo "Required variables:"
        echo "  MONGO_USERNAME=admin"
        echo "  MONGO_PASSWORD=your-secure-password"
        echo "  JWT_SECRET=your-jwt-secret"
        echo "  OPENAI_API_KEY=your-openai-key"
        echo "  DEEPGRAM_API_KEY=your-deepgram-key"
        echo "  ELEVENLABS_API_KEY=your-elevenlabs-key"
        exit 1
    fi
fi

# Create required directories
log "Creating required directories..."
mkdir -p docker/ssl docker/nginx-logs

# Fresh install - remove everything
if [[ "$FRESH" == true ]]; then
    warn "Fresh install requested - removing all containers and volumes..."
    docker compose -f docker-compose.prod.yml down -v --remove-orphans 2>/dev/null || true
    docker system prune -f
    success "Cleaned up old installation"
fi

# Stop existing containers
log "Stopping existing containers..."
docker compose -f docker-compose.prod.yml down --remove-orphans 2>/dev/null || true

# Build images
if [[ "$FRESH" == true ]] || [[ "$REBUILD" == true ]]; then
    log "Building images (no cache)..."
    docker compose -f docker-compose.prod.yml build --no-cache
else
    log "Building images..."
    docker compose -f docker-compose.prod.yml build
fi

# Start all services
log "Starting services..."
docker compose -f docker-compose.prod.yml up -d

# Wait for services
log "Waiting for services to be ready..."
sleep 15

# Show status
echo ""
success "=== Container Status ==="
docker compose -f docker-compose.prod.yml ps

# Test health
echo ""
log "Testing health endpoint..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost/health 2>/dev/null || echo "000")
if [[ "$HTTP_CODE" == "200" ]]; then
    success "Health check passed! (HTTP $HTTP_CODE)"
else
    warn "Health check returned HTTP $HTTP_CODE"
fi

# Show recent logs
echo ""
log "Recent logs:"
docker compose -f docker-compose.prod.yml logs --tail=10

echo ""
echo -e "${GREEN}╔═══════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║              🎉 DEPLOYMENT COMPLETE! 🎉                   ║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "Your site should be live at: ${GREEN}http://$(hostname -I | awk '{print $1}')${NC}"
echo ""
echo -e "Useful commands:"
echo -e "  ${YELLOW}docker compose -f docker-compose.prod.yml logs -f${NC}      - View logs"
echo -e "  ${YELLOW}docker compose -f docker-compose.prod.yml ps${NC}           - Check status"
echo -e "  ${YELLOW}docker compose -f docker-compose.prod.yml restart${NC}      - Restart all"
echo -e "  ${YELLOW}./deploy.sh --rebuild${NC}                                  - Rebuild & restart"
echo ""
