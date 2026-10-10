# The viewer as one image for every deployment. The settings a deployment differs by are read at start: config.json,
# mounted at /usr/share/nginx/html/config.json, and the variables deploy/nginx/40-gateway-and-policy.sh reads.
# Base images are pinned by digest, the tag in front of it.
FROM node:24.21.0-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@12.4.1+sha512.2e81e399d73fe8390dab25e06aa788ab7a5908248d2f5a370f82b481147a6a7a367bf8048f9a6fdb6460f21a66f0542dedb8b94ca2c8723596741920b1656d4c --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM nginx:1.30.4-alpine@sha256:dc5069ad14f19660b141b21236140b91656bf89bbc3e2417c70ae650cd66104c
COPY --from=build /app/dist /usr/share/nginx/html
COPY deploy/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY deploy/nginx/40-gateway-and-policy.sh /docker-entrypoint.d/40-gateway-and-policy.sh
ENV GATEWAY_MODE=proxy
EXPOSE 80
