# The hostile site: a small page that embeds Swarm ID, built against the libraries the kit packed, served static. Its
# nginx answers with no content security policy and lets any site fetch it, because a hostile site has no reason to
# protect itself. The libraries arrive as the build context named `libraries`, as the viewer's do.
FROM node:24.21.0-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@12.4.1+sha512.2e81e399d73fe8390dab25e06aa788ab7a5908248d2f5a370f82b481147a6a7a367bf8048f9a6fdb6460f21a66f0542dedb8b94ca2c8723596741920b1656d4c --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY --from=libraries . /libraries/
RUN node /libraries/install.mjs
COPY kit/evil ./kit/evil
RUN pnpm exec vite build -c kit/evil/vite.config.ts

FROM nginx:1.30.4-alpine@sha256:dc5069ad14f19660b141b21236140b91656bf89bbc3e2417c70ae650cd66104c
COPY --from=build /app/kit/evil/dist /usr/share/nginx/html
COPY kit/evil/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
