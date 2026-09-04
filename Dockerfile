# Pins Node and the dependency tree so tests and builds behave the same on any machine.
FROM node:24-alpine

WORKDIR /app

# Dependencies are their own layer: source edits do not trigger a reinstall.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

CMD ["npm", "run", "check"]
