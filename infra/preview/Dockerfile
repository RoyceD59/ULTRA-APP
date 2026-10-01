FROM node:24-bookworm

RUN npm install --global pnpm@10.28.2
WORKDIR /workspace
ENV CI=true
COPY --chown=node:node . .
USER node
RUN pnpm install --frozen-lockfile --ignore-scripts
