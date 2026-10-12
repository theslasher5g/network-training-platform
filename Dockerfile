# Stufe 1: Einzeldatei aus src/ bauen
FROM python:3.12-alpine AS build
WORKDIR /app
COPY build.py ./
COPY src ./src
RUN python3 build.py

# Stufe 2: statisch ausliefern
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist/netlab.html /usr/share/nginx/html/index.html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
