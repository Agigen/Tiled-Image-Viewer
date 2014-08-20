/*global define, module */
(function (factory) {
    "use strict";
    if ( typeof define === 'function' && define.amd ) {
        // AMD. Register as an anonymous module.
        define('tiledImageViewer', ['pixi', 'underscore', 'jquery'], factory);
    } else if (typeof exports === 'object') {
        // Node/CommonJS style for Browserify
        module.exports = factory;
    } else {
        // Browser globals
        window.agigen = window.agigen || {};
        window.agigen.tiledImageViewer = factory(window.PIXI, window._, window.jQuery);
    }
}(function(PIXI, _, $) {
    "use strict";

    if (typeof PIXI === 'undefined') {
        throw "PIXI is required to use this library";
    }

    if (typeof _ === 'undefined') {
        throw "underscore.js is required to use this library";
    }

    if (typeof $ === 'undefined') {
        console.warn("jQuery was not found, no mouse or touch events will be bound");
    }

    var TiledImageViewer,
        debug,
        zoomDamping,
        dragDamping,
        defaultConfig,
        PAN_DIRECTION_RIGHT,
        PAN_DIRECTION_LEFT,
        noop;

    noop = function() {};

    debug = (function(doDebug) {
        return doDebug ? console : {
            log: noop,
            groupCollapsed: noop,
            groupEnd: noop
        };
    })(true);

    PAN_DIRECTION_RIGHT = 1;
    PAN_DIRECTION_LEFT = -1;

    zoomDamping = 5;
    dragDamping = 5;

    defaultConfig = {
        width: 158701,
        height: 26180,
        maxTileZoom: 8,
        minTileZoom: 1,
        maxZoom: 8,
        minZoom: 1,
        defaultZoom: 6,
        tileSize: 512,
        tilePath: null
    };

    TiledImageViewer = (function() {
        function TiledImageViewer (el, config) {
            debug.log('Running TiledImageViewer service');

            this.el = el;
            this.followMouse = false;

            this.config = _.extend({}, defaultConfig, config || {});

            // @todo: check for required options

            this._init();
        }

        TiledImageViewer.prototype.init = function() {

        };


        TiledImageViewer.prototype._init = function() {
            // Init
            this._setupPixi();
            this._setupMap();
            this._bindEvents();

            this.init()

            this._render();
        };


        TiledImageViewer.prototype._setupPixi = function() {
            var renderDimensions;
            this.stage = new PIXI.Stage(0x222222);
            this.dpr = 1;


            renderDimensions = {width: this.el.offsetWidth, height: this.el.offsetHeight};

            // if (Device.sketen) {
            //     renderDimensions.width = Math.round(window.innerWidth / 2);
            //     renderDimensions.height = Math.round(window.innerHeight / 2);
            //     this.el.classNames += ' lowperf-device';
            // }

            this.renderer = PIXI.autoDetectRenderer(renderDimensions.width, renderDimensions.height, null, false, false);

            debug.log("Renderer:", this.renderer);


            this.el.appendChild(this.renderer.view);


            TiledImageViewer.mapWidth = this.renderer.view.clientWidth;
            TiledImageViewer.mapHeight = this.renderer.view.clientHeight;

            debug.log("Client dimensions:", this.renderer.view.clientWidth, this.renderer.view.clientHeight);
        };


        TiledImageViewer.prototype._setupMap = function() {
            var box, i, x, y, maxAvailableXTile, maxAvailableYTile;

            this._resize();

            this.zoom = this.config.defaultZoom;
            this.currentZoom = this.zoom;
            this.currentZoomLevel = Math.floor(Math.round(this.currentZoom*10)/10);
            this.tileLoadingCounter = 0;
            this.tiles = {};

            this.panDirection = PAN_DIRECTION_RIGHT;
            this.panSpeed = 0;

            if (!this.config.center) {
                this.setCenter({
                    x: this.config.width / 2,
                    y: this.config.height / 2
                });
            } else {
                this.setCenter(this.config.center);
            }


            this.mapHeight = 0;
            this.mapWidth = 0;

            this.mapContainerZoom = [];

            this.mapContainer = new PIXI.DisplayObjectContainer();
            this.mapContainerZoomLevels = new PIXI.DisplayObjectContainer();
            this.mapContainer.interactive = true;

            this.mapContainerBackground = new PIXI.DisplayObjectContainer();

            box = new PIXI.Graphics()
                .beginFill(0x363636)
                .drawRect(0, 0, this.config.width, this.config.height)
                .endFill();

            box.position.x = 0;
            box.position.y = 0;

            this.mapContainerBackground.addChild(box);
            this.mapContainerBackground.scale.x = this.mapContainerBackground.scale.y = 1 / Math.pow(2, this.currentZoom - 1);
            this.mapContainer.addChild(this.mapContainerBackground);

            for (i = this.config.maxZoom; i >= this.config.minZoom; i--) {
                this.mapContainerZoom[i] = new PIXI.DisplayObjectContainer();

                this.mapContainerZoom[i].visible = true;

                // Scale the containers
                this.mapContainerZoom[i].scale.x = this.mapContainerZoom[i].scale.y = 1 / Math.pow(2, this.currentZoom - i);

                this.mapContainerZoomLevels.addChild(this.mapContainerZoom[i]);
            }

            this.mapContainer.addChild(this.mapContainerZoomLevels);

            this._loadMap();

            // add it to the stage
            this.stage.addChild(this.mapContainer);


            debug.groupCollapsed("TiledImageViewer load top level tiles");
            // Preload all tiles in top layer
            maxAvailableXTile = this.config.width / Math.pow(2, this.config.maxTileZoom - 1);
            maxAvailableYTile = this.config.height / Math.pow(2, this.config.maxTileZoom - 1);

                debug.log(this.config);

            for (x = 0; x <= maxAvailableXTile; x+=this.config.tileSize) {
                for (y = 0; y <= maxAvailableYTile; y+=this.config.tileSize) {
                    this._addTile(x, y, this.config.maxTileZoom);
                }
            }

            this.setCenter({x: this.config.width / 2, y: this.config.height / 2});

            debug.groupEnd();
        };

        TiledImageViewer.prototype._bindEvents = function() {
            var lastMouseUp,
                setMouseCoordinates,
                mouseMoveData = {
                    start: { x: 0, y: 0, center: null, position: null },
                },
                mouseLog = [];

            this.on('resize', this._resize.bind(this));

            if (typeof $ === 'undefined') {
                return;
            }

            setMouseCoordinates = function (e) {
                if (e.originalEvent && e.originalEvent.touches && e.originalEvent.touches.length > 0) {
                    console.log(e.originalEvent.touches);
                    this.mouseCoordinates = {
                        x: _.reduce(_.map(e.originalEvent.touches, function(t) { return t.pageX; }), function(a, b) { return a+b; }) / e.originalEvent.touches.length,
                        y: _.reduce(_.map(e.originalEvent.touches, function(t) { return t.pageY; }), function(a, b) { return a+b; }) / e.originalEvent.touches.length,
                    };
                } else {
                    this.mouseCoordinates = {
                        x: e.originalEvent.pageX,
                        y: e.originalEvent.pageY
                    };
                }
            }.bind(this);

            // use the mousedown and touchstart
            //mapContainer.mousedown = mapContainer.touchstart = function(data)
            $(this.renderer.view).on('mousedown touchstart', function(e) {
                e.preventDefault();

                setMouseCoordinates(e);

                mouseMoveData.start.center = this.getCenter();
                mouseMoveData.start.position = this.mapContainer.position.clone();
                mouseMoveData.start.x = this.mouseCoordinates.x;
                mouseMoveData.start.y = this.mouseCoordinates.y;

                mouseLog = [];

                if (e.originalEvent.touches) {
                    if (e.originalEvent.touches.length === 1) {
                        this.dragging = true;
                        this.pinching = false;
                    } else if (e.originalEvent.touches.length === 2) {
                        this.pinching = true;
                        this.dragging = false;

                        mouseMoveData.start.distance = Math.sqrt(
                            Math.pow(e.originalEvent.touches[0].pageX - e.originalEvent.touches[1].pageX, 2) +
                            Math.pow(e.originalEvent.touches[0].pageY - e.originalEvent.touches[1].pageY, 2)
                        );

                        mouseMoveData.start.zoom = this.zoom;
                    } else {
                        this.dragging = false;
                        this.pinching = false;
                    }
                } else {
                    this.dragging = true;
                    this.pinching = false;
                }

                _.defer(function() {
                    this.trigger('mousedown', e);
                }.bind(this));
            }.bind(this));

            // set the events for when the mouse is released or a touch is released
            $(this.renderer.view).on('mouseup touchend', function(e) {
                var eventCoordinates, mouseMoveDelta, currentTime, timeDelta, coordinates, sx, sy, realX, realY, _tiles, tx, ty

                e.preventDefault();

                e.tiledImageEvent = {};

                eventCoordinates = {
                    x: this.mouseCoordinates.x,
                    y: this.mouseCoordinates.y
                };

                e.tiledImageEvent.coordinates = this.containerPixelToCoordinate(this.mouseCoordinates);

                mouseMoveDelta = {
                    x: mouseMoveData.start.x - eventCoordinates.x,
                    y: mouseMoveData.start.y - eventCoordinates.y
                };

                mouseMoveData.start = { x: 0, y: 0 };

                // Check for double clicks
                currentTime = Date.now();
                timeDelta = currentTime - lastMouseUp;

                // 350 feels like a good double click interval?
                if (!this.pinching && lastMouseUp && timeDelta < 350 && Math.abs(mouseMoveDelta.x) < 10 && Math.abs(mouseMoveDelta.y) < 10) {
                    lastMouseUp = 0;

                    this.setZoom(this.zoom - 1, true);
                    _.defer(function() {
                        this.trigger('doubleclick', e);
                    }.bind(this));
                } else {
                    /**
                     * 5 here is just some kind of max delta thing
                     */
                    if (this.pinching) {
                        // do nothing
                    } else if (Math.abs(mouseMoveDelta.x) < 5 && Math.abs(mouseMoveDelta.y) < 5) {
                        this.trigger('click', e);

                        coordinates = this.containerPixelToCoordinate(eventCoordinates);
                        _tiles = [];

                        for (var i = this.config.minTileZoom; i <= this.config.maxTileZoom; i++) {
                            tx = Math.floor(coordinates.x / Math.pow(2, i - 1) / this.config.tileSize) * this.config.tileSize;
                            ty = Math.floor(coordinates.y / Math.pow(2, i - 1) / this.config.tileSize) * this.config.tileSize;

                            _tiles.push(i + "/tile_"+tx+"_"+ty+".jpg")
                        }

                        debug.log("Mouse click at:", coordinates);
                        debug.log("Mouse click on tiles:", _tiles);
                    } else {
                        if (mouseLog.length > 2 && ((new Date())*1 - mouseLog[mouseLog.length - 1].time) < 100) {
                            sx = (mouseLog[0].x - mouseLog[mouseLog.length - 1].x) / (mouseLog[0].time - mouseLog[mouseLog.length - 1].time) * this.dpr;
                            sy = (mouseLog[0].y - mouseLog[mouseLog.length - 1].y) / (mouseLog[0].time - mouseLog[mouseLog.length - 1].time) * this.dpr;

                            realX = sx * Math.pow(2, this.currentZoom-1) * 100;
                            realY = sy * Math.pow(2, this.currentZoom-1) * 100;

                            this.panTo({x: this.center.x - realX, y: this.center.y - realY});
                        }
                    }

                    _.defer(function() {
                        this.trigger('mouseup', e);
                    }.bind(this));

                    lastMouseUp = currentTime;
                }

                this.el.style.cursor = 'inherit';
            }.bind(this));

            // set the callbacks for when the mouse or a touch moves
            $(this.renderer.view).on('mousemove touchmove', function(e) {
                var dx, dy, newX, newY, d2, scale;

                e.preventDefault();
                setMouseCoordinates(e);

                e.tiledImageEvent = {};
                e.tiledImageEvent.coordinates = this.containerPixelToCoordinate(this.mouseCoordinates);

                if (this.dragging && mouseMoveData.start.center) {
                    dx = this.mouseCoordinates.x - mouseMoveData.start.x;
                    dy = this.mouseCoordinates.y - mouseMoveData.start.y;

                    newX = mouseMoveData.start.center.x - dx * this.dpr * Math.pow(2, this.currentZoom - 1);
                    newY = mouseMoveData.start.center.y - dy * this.dpr * Math.pow(2, this.currentZoom - 1);

                    mouseLog.push({
                        x: this.mouseCoordinates.x,
                        y: this.mouseCoordinates.y,
                        time: new Date()*1,
                    });

                    mouseLog = mouseLog.slice(-10);

                    this.setCenter({x: newX, y: newY});

                    this.el.style.cursor = 'move';
                }

                if (this.pinching && e.originalEvent.touches && e.originalEvent.touches.length === 2) {
                    d2 = Math.sqrt(
                        Math.pow(e.originalEvent.touches[0].pageX - e.originalEvent.touches[1].pageX, 2) +
                        Math.pow(e.originalEvent.touches[0].pageY - e.originalEvent.touches[1].pageY, 2)
                    );
                    scale = d2/mouseMoveData.start.distance;

                    this.setZoom(mouseMoveData.start.zoom - Math.log(scale), true /* follow touches */, true /* force update (no damping) */);
                }

                this.trigger('mousemove', e);
            }.bind(this));

            $(this.renderer.view).on('mousewheel', function(e) {
                var delta, newZoom;

                e.preventDefault();
                delta = e.deltaY * e.deltaFactor;

                if (delta) {
                    newZoom = this.zoom - delta / 3 / 32;
                    this.setZoom(newZoom, true /* follow mouse */);
                }
            }.bind(this));
        };


        TiledImageViewer.prototype._resize = function() {
            this.renderer.resize(this.el.offsetWidth, this.el.offsetHeight);
        };


        TiledImageViewer.prototype.getMapSizeForZoom = function(zoom) {
            var map_width, map_height;

            map_width = Math.ceil(this.config.width / Math.pow(2, zoom-1));
            map_height = Math.ceil(this.config.height / Math.pow(2, zoom-1));

            return {width: map_width, height: map_height};
        };


        var _loadMap = function() {
            var currentZoom, mapDimensions, zoomDiff, map_width, map_height, pos_x, pos_y, w, h, startPointX, startPointY, endPointX, endPointY, maxAvailableXTile, maxAvailableYTile;

            currentZoom = Math.floor(Math.max(Math.min(this.currentZoom, this.config.maxTileZoom), this.config.minTileZoom)*10) / 10;

            if (Math.floor(currentZoom) !== this.currentZoomLevel) {
                // Loading a new zoom level
                debug.log("Load a new zoom level!");
                this.currentZoomLevel = Math.floor(Math.round(this.currentZoom*10)/10);

                // place current zoom level at top of containers children
                this.mapContainerZoomLevels.removeChild(this.mapContainerZoom[this.currentZoomLevel]);
                this.mapContainerZoomLevels.addChild(this.mapContainerZoom[this.currentZoomLevel]);
            }


            debug.groupCollapsed("TiledImageViewer.loadMap");
            debug.log("Find out which tiles are needed");
            debug.log("Dimensions of the map:", this.config.width, this.config.height);
            // debug.log("Size of the tiles: ", this.config.tileSize);
            debug.log("Current zoom:", currentZoom);
            debug.log("Zoom level:", this.currentZoomLevel);

            mapDimensions = this.getMapSizeForZoom(this.currentZoomLevel);
            zoomDiff = currentZoom - this.currentZoomLevel;

            map_width  = mapDimensions.width;
            map_height = mapDimensions.height;
            pos_x      = this.mapContainer.position.x * -1   * Math.pow(2, zoomDiff);
            pos_y      = this.mapContainer.position.y * -1   * Math.pow(2, zoomDiff);
            w          = window.innerWidth                   * Math.pow(2, zoomDiff);
            h          = window.innerHeight                  * Math.pow(2, zoomDiff);

            debug.log("Zoom difference:", zoomDiff);
            debug.log("Closest zoomed dimensions of the map:", map_width, map_height);
            debug.log("Current part of map visible:", pos_x, pos_y);

            startPointX = Math.floor(pos_x / this.config.tileSize) * this.config.tileSize;
            startPointY = Math.floor(pos_y / this.config.tileSize) * this.config.tileSize;

            endPointX = Math.floor((pos_x + w) / this.config.tileSize) * this.config.tileSize + this.config.tileSize;
            endPointY = Math.floor((pos_y + h) / this.config.tileSize) * this.config.tileSize + this.config.tileSize;

            debug.log(startPointX, endPointX);
            debug.log(startPointY, endPointY);

            maxAvailableXTile = Math.floor(map_width / this.config.tileSize) * this.config.tileSize;
            maxAvailableYTile = Math.floor(map_height / this.config.tileSize) * this.config.tileSize;

            debug.log("Max available tiles: ", maxAvailableXTile, maxAvailableYTile);

            var maxXTile = Math.min(maxAvailableXTile, endPointX);
            var maxYTile = Math.min(maxAvailableYTile, endPointY);

            debug.log("Load X tiles from", startPointX, maxXTile);
            debug.log("Load Y tiles from", startPointY, maxYTile);

            var x, y, added = 0, removed = 0;

            for (x = 0; x <= maxAvailableXTile; x+=this.config.tileSize) {
                for (y = 0; y <= maxAvailableYTile; y+=this.config.tileSize) {

                    if (startPointX <= x && x <= endPointX &&
                        startPointY <= y && y <= endPointY)
                    {
                        if (this._addTile(x, y, this.currentZoomLevel)) {
                            added++;
                        }
                    } else {
                        if (this._hideTile(x, y, this.currentZoomLevel)) {
                            removed++;
                        }
                    }

                }
            }

            // add nex tiles outside of visible area
            for (x = Math.max(0, startPointX - this.config.tileSize); x <= Math.min(maxAvailableXTile, endPointX + this.config.tileSize); x+=this.config.tileSize) {
                for (y = Math.max(0, startPointY - this.config.tileSize); y <= Math.min(maxAvailableYTile, endPointY + this.config.tileSize); y+=this.config.tileSize) {

                    if (startPointX > x || x > endPointX &&
                        startPointY > y || y > endPointY)
                    {
                        if (this._addTile(x, y, this.currentZoomLevel)) {
                            added++;
                        }
                    }

                }
            }

            debug.log("Added", added, "tiles");

            if (added === 0) {
                debug.log('No added tiles for this view, hide layers');
                this._hideZoomLayers();
            }

            debug.groupEnd();
        };


        TiledImageViewer.prototype._loadMap = _.throttle(_loadMap, 250);
        TiledImageViewer.prototype._loadMapMedium = _.throttle(_loadMap, 1250);
        TiledImageViewer.prototype._loadMapSlow = _.throttle(_loadMap, 3000);
        TiledImageViewer.prototype._loadMapDebounced = _.debounce(_loadMap, 250);


        TiledImageViewer.prototype.on = function(event, callback) {
            event = event.toLowerCase();

            if (typeof this.itemMapEventCallbacks === 'undefined') {
                this.itemMapEventCallbacks = {};
            }

            if (!this.itemMapEventCallbacks[event]) {
                this.itemMapEventCallbacks[event] = [];
            }

            this.itemMapEventCallbacks[event].push(callback);
        };


        TiledImageViewer.prototype.trigger = function(event) {
            var args = Array.prototype.slice.call(arguments, 1);

            event = event.toLowerCase();

            if (typeof this.itemMapEventCallbacks === 'undefined') {
                this.itemMapEventCallbacks = {};
            }

            if (this.itemMapEventCallbacks[event]) {
                _.each(this.itemMapEventCallbacks[event], function(callback) {
                    callback.apply(this, args);
                }.bind(this));
            }
        };


        TiledImageViewer.prototype.panTo = function(coordinate) {
            this.targetCenter = coordinate;
        };


        TiledImageViewer.prototype.setCenter = function(coordinate) {
            this.center = this.targetCenter = coordinate;

            if (this.mapContainer) {
                this._loadMap();
            }
        };


        TiledImageViewer.prototype.getCenter = function() {
            return this.center;
        };


        TiledImageViewer.prototype._addSpriteToMap = function (x, y, texture, mc) {

            var sprite = new PIXI.Sprite(texture);
            sprite.anchor.x = sprite.anchor.y = 0;
            sprite.position.x = x;
            sprite.position.y = y;
            sprite.visible = true;

            // Add the sprite to the DisplayObjContainer
            mc.addChild(sprite);

            return sprite;
        };


        TiledImageViewer.prototype._addTile = function (tileX,tileY, zoomLevel) {
            var src = this.config.tilePath + zoomLevel + "/tile_"+tileX+"_"+tileY+".jpg",
                mc = this.mapContainerZoom[zoomLevel],
                that = this,
                loader;

            // Callback when image is loaded (only triggered once)


            if (typeof this.tiles[zoomLevel + '_' + tileX + '_' + tileY] !== 'undefined') {
                debug.log('Show existing sprite');

                // Add the sprite to the DisplayObjContainer
                //TiledImageViewer.mapContainerZoom[zoomLevel].addChild(this.tiles[zoomLevel + '_' + tileX + '_' + tileY]);
                this.tiles[zoomLevel + '_' + tileX + '_' + tileY].visible = true;
                return false;
            } else {
                debug.log('Loading', src);
                this._showAllZoomLayers();
                this.tileLoadingCounter++;

                loader = new PIXI.ImageLoader(src, true);
                loader.onLoaded = function() {
                    that.tiles[zoomLevel + '_' + tileX + '_' + tileY] = that._addSpriteToMap(tileX, tileY, this.texture, mc);

                    if (--that.tileLoadingCounter === 0) {
                        debug.log("All tiles loaded, hiding other zoom levels");
                        that._hideZoomLayers();
                    }
                };


                loader.load();
                return true;
            }

        }

        TiledImageViewer.prototype._hideTile = function (x, y, zoomLevel) {
            if (typeof this.tiles[zoomLevel + '_' + x + '_' + y] !== 'undefined') {
                debug.log('Hide existing sprite');
                this.tiles[zoomLevel + '_' + x + '_' + y].visible = false;
                return true;
            }

            return false;
        };

        TiledImageViewer.prototype._showAllZoomLayers = function () {
            for (var i = this.config.minTileZoom; i <= this.config.maxTileZoom; i++) {
                this.mapContainerZoom[i].visible = true;
            }
        };

        TiledImageViewer.prototype._hideZoomLayers = function () {
            for (var i = this.config.minTileZoom; i <= this.config.maxTileZoom; i++) {
                if (i !== this.currentZoomLevel) {
                    this.mapContainerZoom[i].visible = false;
                }
            }

            this.mapContainerZoom[this.currentZoomLevel].visible = true;
        };


        TiledImageViewer.prototype.setZoom = function(zoom, zoomPoint, force) {
            if (zoom === this.config.minZoom || zoom === this.config.maxZoom) {
                return;
            }

            if (zoom < this.config.minZoom) {
                zoom = this.config.minZoom;
            }
            else if (zoom > this.config.maxZoom) {
                zoom = this.config.maxZoom;
            }

            this.followMouse = !!zoomPoint;

            if (Math.floor(Math.round(zoom*10)/10) !== this.zoomLevel && this.tileLoadingCounter === 0) {
                this.zoomLevel = Math.floor(Math.round(zoom*10)/10);
                debug.log("Zooming with zoom layers hidden, show them all");
                this._showAllZoomLayers();
            }

            this.zoom = zoom;

            this.trigger('zoomChange', zoom);

            if (force) {
                this._updateZoom(undefined, true);
            }
        };


        TiledImageViewer.prototype.getZoom = function() {
            return this.zoom;
        };


        TiledImageViewer.prototype.containerPixelToCoordinate = function(point) {
            var realX, realY, x, y;

            x = Math.round(point.x * this.dpr);
            y = Math.round(point.y * this.dpr);

            realX = (x - this.mapContainer.position.x) * Math.pow(2, this.currentZoom-1);
            realY = (y - this.mapContainer.position.y) * Math.pow(2, this.currentZoom-1);

            return {x: realX, y: realY};
        };


        TiledImageViewer.prototype.coordinateToContainerPixel = function(coordinate) {
            var containerX, containerY;

            containerX = (coordinate.x / Math.pow(2, this.currentZoom-1) + this.mapContainer.position.x) * this.dpr;
            containerY = (coordinate.y / Math.pow(2, this.currentZoom-1) + this.mapContainer.position.y) * this.dpr;

            return {x: containerX, y: containerY};
        };


        TiledImageViewer.prototype.autoPan = function(duration) {
            if ((this.getMapSizeForZoom(this.currentZoom).width - window.innerWidth) < 0) {
                // image does not fill window
                return;
            }

            this.panSpeed = (this.config.width - window.innerWidth * Math.pow(2, this.currentZoom)) / duration;
        };


        TiledImageViewer.prototype.stopAutoPan = function() {
            this.panSpeed = 0;
        };


        TiledImageViewer.prototype._updateAutoPan = function() {
            var p1, p2;

            if (Math.abs(this.panSpeed) > 0) {
                p1 = this.containerPixelToCoordinate({x: 0, y: 0});
                p2 = this.containerPixelToCoordinate({x: window.innerWidth, y: window.innerHeight});


                if (p1.x < 0 && this.panDirection === PAN_DIRECTION_LEFT) {
                    this.panDirection = PAN_DIRECTION_RIGHT;
                    this.trigger('panDirectionChange', this.panDirection);
                } else if (p2.x > this.config.width && this.panDirection === PAN_DIRECTION_RIGHT) {
                    this.panDirection = PAN_DIRECTION_LEFT;
                    this.trigger('panDirectionChange', this.panDirection);
                } else {

                    this.center.x = this.targetCenter.x = this.center.x + this.panSpeed*this.lastAnimTimeDelta*this.panDirection;
                    this._loadMapSlow();
                }
            }
        };


        TiledImageViewer.prototype._updateZoom = function(time, force) {
            var zoomDiff, zoomScale, z, c1, c2, i, newScale,
                threshold = 0.01;

            if (Math.abs(this.currentZoom - this.zoom) > threshold) {

                if (force) {
                    zoomDiff = this.zoom - this.currentZoom;
                } else {
                    zoomDiff = ((this.zoom - this.currentZoom) / Math.max(1, zoomDamping * (60 / this.lastAnimTimeDelta)));
                }

                zoomScale = Math.pow(2, -zoomDiff);

                if (this.followMouse) {
                    z = this.containerPixelToCoordinate(this.mouseCoordinates);
                    c1 = this.getCenter();

                    c2 = {
                        x: c1.x - (c1.x - z.x) * zoomScale * -zoomDiff * (Math.sqrt(2/zoomScale) / (2*zoomScale)),
                        y: c1.y - (c1.y - z.y) * zoomScale * -zoomDiff * (Math.sqrt(2/zoomScale) / (2*zoomScale)),
                    };

                    this.setCenter(c2);
                }


                this.currentZoom += zoomDiff;
                this._loadMapMedium();

                // Scale the actual containers
                for (i = this.config.minZoom; i <= this.config.maxZoom; i++) {
                    newScale = 1 / Math.pow(2, this.currentZoom - i);
                    this.mapContainerZoom[i].scale.x = this.mapContainerZoom[i].scale.y = newScale;
                }

                this.mapContainerBackground.scale.x = this.mapContainerBackground.scale.y = 1 / Math.pow(2, this.currentZoom - 1);

                this.mapContainerZoom[Math.max(Math.min(this.currentZoomLevel, this.config.maxTileZoom), this.config.minTileZoom)].visible = true;

            }
        };


        TiledImageViewer.prototype._updatePosition = function() {
            var threshold = 0.01;

            if (Math.abs(this.center.x - this.targetCenter.x) > threshold) {
                this.center.x += ((this.targetCenter.x - this.center.x) / dragDamping);
                this._loadMapMedium();
            }

            if (Math.abs(this.center.y - this.targetCenter.y) > threshold) {
                this.center.y += ((this.targetCenter.y - this.center.y) / dragDamping);
                this._loadMapMedium();
            }

            this.mapContainer.position.x = -(this.center.x / Math.pow(2, this.currentZoom - 1)) + this.el.offsetWidth / 2;
            this.mapContainer.position.y = -(this.center.y / Math.pow(2, this.currentZoom - 1)) + this.el.offsetHeight / 2;
        };


        //var lastFrames = [], fps;
        TiledImageViewer.prototype._render = function(time) {
            time = time || 0;

            window.requestAnimFrame(this._render.bind(this));

            // lastFrames.push(time);
            // lastFrames = lastFrames.slice(-180);

            // fps = lastFrames.length / ((lastFrames[lastFrames.length - 1] - lastFrames[0]) / 1000);

            this.lastAnimTimeDelta = time - (this.lastAnimTime || 0);
            this.lastAnimTime = time;

            this._updateZoom(time);
            this._updatePosition(time);
            this._updateAutoPan(time);

            this.renderer.render(this.stage);
        };

        return TiledImageViewer;

    }());

    // exports
    return {
        TiledImageViewer: TiledImageViewer
    };

}));
