var exec = require('child_process').exec
  , path = require('path')
  , Identify = require('identify.js')


var ImageMagick = module.exports = function(config, logger) {
  if(!config) throw new Error('Where is my config?')

  this.config = config
  this.config.timeouts = this.config.timeouts || {}

  this.logger = logger || { log: function(){} }
}

ImageMagick.Templates = {
  tmpPath: "/tmp/node-image-magick/%{dir}/%{file}",

  downloadCmd: "curl -L --create-dirs -sf '%{source}' -o '%{target}'",
  identifyCmd: "identify -format %m '%{file}'",
  identifyVerboseCmd: "identify -verbose '%{file}'",
  createBlankImageCmd: "convert -bordercolor '#B1B1B1' -background '#eee' -border 1 -size %{size} -fill '#900' -font '/Library/Fonts/Arial Bold.ttf' -pointsize 16 label:' x' '%{tmpfile}'",
  resizeCmd: "-resize '%{size}'",
  fitCmd: "-gravity center -resize '%{size}'^ -extent %{size}",
  cropCmd: "-crop %{crop} +repage -thumbnail '%{size}'",
  smartFitCmd: "-resize %{x}x -resize 'x%{x}<' -resize 50% -gravity center  -crop %{size}+0+0 +repage",
  
  checkValue: function(value) {
    if(value.toString().match(/[^\-_:\/+<>\\#%\.\^a-z0-9]/gi))
      throw new Error('Unallowed characters in replacement: ' + value.toString())

    return value
  },

  get: function(key, replacements) {
    var result = ImageMagick.Templates[key]

    for(var k in replacements) {
      var value = ImageMagick.Templates.checkValue(replacements[k])
        , key   = new RegExp("%{" + k + "}", "g")

      result = result.replace(key, value)
    }

    return result
  }
}

ImageMagick.prototype.identify = function(params, callback) {
  if(!params.hasOwnProperty('url'))
    throw new Error('Identify needs url param!')

  Identify.parseFile(ImageMagick.Templates.checkValue(params.url), callback)
}

ImageMagick.prototype.resize = function(params, callback) {
  if(!params.hasOwnProperty('size'))
    throw new Error('Resize needs size-param with format <width>x<height>!')

  this._convert(ImageMagick.Templates.get('resizeCmd', { size: params.size }), params, callback)
}

ImageMagick.prototype.fit = function(params, callback) {
  if(!params.hasOwnProperty('size'))
    throw new Error('Fit needs size-parameter with format <width>x<height>!')

  this._convert(ImageMagick.Templates.get('fitCmd', { size: params.size }), params, callback)
}

ImageMagick.prototype.smartfit = function(params, callback) {
  if(!params.hasOwnProperty('size'))
    throw new Error('Smart Fit needs size-parameter with format <width>x<height>!')

  var x = parseInt(params.size.split('x')[0]) * 2;
  this._convert(ImageMagick.Templates.get('smartFitCmd', { size: params.size, x: x }), params, callback)
}

ImageMagick.prototype.crop = function(params, callback) {
  if(!params.hasOwnProperty('crop'))
    throw new Error('Crop needs crop-param with format <width>x<height>+<x>+<y>!')

  var self   = this
  var doCrop = function() {
    var cmd = ImageMagick.Templates.get('cropCmd', {
      crop: params.crop,
      size: params.size || params.crop.split('+')[0]
    })

    self._convert(cmd, params, callback)
  }

  if(params.hasOwnProperty('cropSourceSize')) {
    this._scaleCropParam(params, function() { doCrop() })
  } else {
    doCrop()
  }
}

// private

ImageMagick.prototype.execute = function(cmd, options, callback) {
  var self = this

  this.logger.log('Executing command: ' + cmd)
  exec(cmd, options, function(err, stdout, stderr) {
    self.logger.log('Finished command: ' + cmd)
    callback && callback(err, stdout, stderr)
  })
}

ImageMagick.prototype._scaleCropParam = function(params, callback) {
  var self = this

  this.identify({url: params.url}, function(err, stats) {
    if(err)
      callback && callback(err)
    else {
      params.crop = self._scaleCropInfo(params.crop, params.cropSourceSize.split('x'), stats.Geometry.split('+')[0].split('x'))
      callback && callback()
    }
  })
}

ImageMagick.prototype._scaleCropInfo = function(cropValue, cropSourceSize, sourceDimension) {
  var cropSourceWidth  = cropSourceSize[0]
    , cropSourceHeight = cropSourceSize[1]
    , ratio            = null
    , scaledCropInfo   = null

  if(cropSourceWidth)
    ratio = parseFloat(sourceDimension[0]) / parseFloat(cropSourceWidth)
  else
    ratio = parseFloat(sourceDimension[1]) / parseFloat(cropSourceHeight)

  // before: 200x300+10+20
  // after: [300, 400, 15, 28] (split + multiply by ratio)
  scaledCropInfo = cropValue.split(/[+x]/).map(function(dim) { return parseInt(parseInt(dim) * ratio) })

  // finally: join array to 300x400+15+28
  return [[scaledCropInfo[0], scaledCropInfo[1]].join('x'), scaledCropInfo[2], scaledCropInfo[3]].join('+')
}

ImageMagick.prototype._random = function(number) {
  return parseInt(Math.random() * number)
}

ImageMagick.prototype._downloadSource = function(source, target, callback) {
  this.logger.log('Downloading source')
  this.execute(ImageMagick.Templates.get('downloadCmd', {source: source, target: target}), { timeout: this.config.timeouts.download }, callback)
}

ImageMagick.prototype._localizeSource = function(source, callback) {
  this.logger.log('Localizing source')

  var checkSourceExists = function(_path) {
    path.exists(_path, function(exists) {
      callback(null, exists, _path)
    })
  }

  if(source.indexOf("http") == 0) {
    var tmpfile = ImageMagick.Templates.get('tmpPath', { dir: Date.now(), file: this._random(9999) })

    this._downloadSource(source, tmpfile, function(err, stdout, stderr) {
      if(err && err.killed)
        callback(err, false, null)
      else
        checkSourceExists(tmpfile)
    })
  } else {
    checkSourceExists(source)
  }
}

ImageMagick.prototype._getTempfile = function(source, callback) {
  var self = this

  this._getMimeType(source, function(mimeType) {
    var tmpfile = ImageMagick.Templates.get('tmpPath', { dir: Date.now(), file: self._random(9999) + '.' + mimeType })
    self.execute("mkdir -p " + path.dirname(tmpfile), {}, function() { callback(tmpfile) })
  })
}

ImageMagick.prototype._getMimeType = function(file, callback) {
  this.execute(ImageMagick.Templates.get('identifyCmd', { file: file }), { timeout: this.config.timeouts.identify }, function(_, stdout, _) {
    var mimeType = stdout.toLowerCase().replace("\n", "")
    callback(mimeType == "" ? "jpeg" : mimeType)
  })
}

ImageMagick.prototype._getFallbackImageCommand = function(_size, tmpfile) {
  var size = _size.split('x').map(function(num){
    return (num == "") ? "" : (parseInt(num) - 2)
  }).join("x")

  return ImageMagick.Templates.get('createBlankImageCmd', { size : size, tmpfile: tmpfile})
}

ImageMagick.prototype._checkSizeLimit = function(size) {
  var sizeLimit = this.config.imageSizeLimit

  if(!sizeLimit) return

  var dimension = size.match(/(\d+).*?(\d+)/).slice(1,3)

  dimension.forEach(function(_size) {
    if(parseInt(_size) > sizeLimit)
      throw new Error('Unallowed size! Requested: ' + size + '; Match: ' + _size + '; Allowed: ' + sizeLimit)
  })
}

ImageMagick.prototype._convert = function(_command, params, callback) {
  var source = decodeURIComponent(params.url)
    , self   = this
    , size   = params.size || params.crop.split('+')[0]

  this._checkSizeLimit(params.size)
  this._localizeSource(source, function(err, exists, localizedSource) {
    if(err && !exists)
      return callback && callback(err, null, null)

    self._getTempfile(localizedSource, function(tmpfile) {
      var command = "convert '" + localizedSource + "' " + _command + " " + tmpfile

      if(!exists)
        command = self._getFallbackImageCommand(size, tmpfile)

      self.execute(command, { timeout: self.config.timeouts.convert }, function (err, stdout, stderr) {
        callback && callback(err, tmpfile)
      })
    })
  })
}