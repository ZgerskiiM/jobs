FROM node:22-alpine AS build
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ .
COPY data/ /app/data/
COPY config/ /app/config/
COPY COMPANIES_PROGRESS.md /app/COMPANIES_PROGRESS.md
COPY config.direct.json /app/config.direct.json
COPY companies.top50.json /app/companies.top50.json
COPY .openai/ /app/.openai/
RUN npm run build

FROM nginx:1.27-alpine
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/frontend/dist /usr/share/nginx/html
RUN mkdir -p /usr/share/nginx/catalog \
    && cp /usr/share/nginx/html/vacancies.json /usr/share/nginx/catalog/vacancies.json \
    && cp /usr/share/nginx/html/vacancy-refresh.json /usr/share/nginx/catalog/vacancy-refresh.json
EXPOSE 80
