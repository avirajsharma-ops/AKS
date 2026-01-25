#!/bin/bash

#==============================================================================
# AKS Quick Redeploy Script
# Use this to quickly rebuild and restart containers on production
#==============================================================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}=== AKS Quick Redeploy ===${NC}"

# Change to script directory
cd "$(dirname "${BASH_SOURCE[0]}")"

# Stop existing containers
echo -e "${YELLOW}Stopping existing containers...${NC}"
docker compose -f docker-compose.prod.yml down || true

# Rebuild images without cache
echo -e "${YELLOW}Rebuilding images...${NC}"
docker compose -f docker-compose.prod.yml build --no-cache

# Start containers
echo -e "${YELLOW}Starting containers...${NC}"
docker compose -f docker-compose.prod.yml up -d

# Wait for health checks
echo -e "${YELLOW}Waiting for services to be healthy...${NC}"
sleep 10

# Show status
echo -e "${GREEN}=== Container Status ===${NC}"
docker compose -f docker-compose.prod.yml ps

# Show logs
echo -e "${GREEN}=== Recent Logs ===${NC}"
docker compose -f docker-compose.prod.yml logs --tail=20

echo -e "${GREEN}=== Redeploy Complete ===${NC}"
echo -e "Test the site: curl -I http://localhost/"
