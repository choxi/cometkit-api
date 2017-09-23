FROM jmfirth/webpack
RUN apt-get update
RUN apt-get install vim -y
ADD . /cometkit-api
WORKDIR /cometkit-api
RUN npm install
