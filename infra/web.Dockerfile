FROM node:26.5.0-bookworm-slim AS dependencies

WORKDIR /workspace

COPY package.json package-lock.json .npmrc ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci

FROM dependencies AS development

COPY . .

EXPOSE 5173
CMD ["npm", "run", "dev", "--workspace=@psicogestion/web"]

FROM dependencies AS build

COPY . .
RUN npm run build --workspace=@psicogestion/web

FROM caddy:2.10-alpine AS production

COPY --from=build /workspace/apps/web/dist /usr/share/caddy
EXPOSE 80
