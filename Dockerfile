FROM jmfirth/webpack
RUN apt-get update
RUN apt-get install vim -y
WORKDIR /cometkit-api
ADD package.json .
RUN npm install
ADD . /cometkit-api
ENV PATH="/cometkit-api/node_modules/.bin:${PATH}"
