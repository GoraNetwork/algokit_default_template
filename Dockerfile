from node:16-alpine

RUN apk add -U curl git make gcc g++ bash docker docker-compose python3

RUN npm install -g typescript
RUN python3 -m ensurepip
RUN pip3 install --no-cache --upgrade pip setuptools pyteal pyyaml pycryptodome
ENTRYPOINT ["yarn"]