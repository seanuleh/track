# Stage 1: Build the frontend
FROM node:20-alpine AS frontend-builder
WORKDIR /app
COPY frontend/package.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# Stage 2: PocketBase with bundled frontend
FROM alpine:3.19
ARG PB_VERSION=0.22.22

RUN apk add --no-cache wget unzip ca-certificates

RUN wget -q "https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_amd64.zip" \
    -O /tmp/pb.zip && \
    unzip /tmp/pb.zip -d /pb && \
    rm /tmp/pb.zip && \
    chmod +x /pb/pocketbase

COPY --from=frontend-builder /app/dist /pb/pb_public

COPY pocketbase/entrypoint.sh /pb/entrypoint.sh
RUN chmod +x /pb/entrypoint.sh

COPY pb_hooks/ /pb/pb_hooks/

EXPOSE 8090
ENTRYPOINT ["/pb/entrypoint.sh"]
