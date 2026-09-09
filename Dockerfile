FROM node:20-alpine

WORKDIR /app

# Installe les dépendances d'abord (meilleur cache Docker)
COPY package.json ./
RUN npm install --omit=dev

# Copie le reste du code
COPY . .

ENV PORT=3000
EXPOSE 3000

CMD ["node", "server.js"]
