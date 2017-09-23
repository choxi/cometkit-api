FROM jmfirth/webpack
RUN apt-get update
RUN apt-get install vim
ADD . /cometkit-api
