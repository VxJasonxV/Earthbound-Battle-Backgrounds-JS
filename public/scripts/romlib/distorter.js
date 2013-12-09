define(function(require, exports, module) {

var Distorter = exports.Distorter = function() {
    // There is some redundancy here: 'effect' is currently what is used
    // in computing frames, although really there should be a list of
    // four different effects ('dist') which are used in sequence.
    //
    // 'dist' is currently unused, but ComputeFrame should be changed to
    // make use of it as soon as the precise nature of effect sequencing
    // can be determined.
    //
    // The goal is to make Distorter a general-purpose BG effect class that
    // can be used to show either a single distortion effect, or to show the
    // entire sequence of effects associated with a background entry (including
    // scrolling and Palette animation, which still need to be implemented).
    //
    // Also note that "current_dist" should not be used. Distorter should be
    // a "temporally stateless" class, meaning that all temporal effects should
    // be computed at once, per request, rather than maintaining an internal
    // tick count. (The idea being that it should be fast to compute any
    // individual
    // frame. Since it is certainly possible to do this, there is no sense
    // requiring that all previous frames be computed before any given desired
    // frame.)

    this.effect = new this.DistortionEffect;

    // TODO: new this.DistortionEffect[4] did not work, is this appropriate?
    this.dist = [new this.DistortionEffect(), new this.DistortionEffect(),
                 new this.DistortionEffect(), new this.DistortionEffect()];
    this.current_dist = 1

    this.bmpSrc = null;

    return this;
};

(function(){

    exports.getDistortions = function() {
        return this.dist;
    }

    exports.getCurrentDistortion = function() {
        return this.dist[this.current_dist];
    }

    exports.getEffect = function() {
        return this.effect;
    }

    exports.getEffectAs= function() {
        return this.effect.getDistortionEffect();
    }

    exports.setEffect = function(value) {
        this.effect = value;
    }

    exports.getOriginal = function() {
        return this.bmpSrc;
    }

    exports.setOriginal = function(value) {
        this.bmpSrc = value;
    }

    exports.overlayFrame = function(dst, letterbox, ticks, alpha, erase) {
        var e = erase ? 1 : 0;

        return this.ComputeFrame(dst, this.bmpSrc, this.getEffectAsInt(), letterbox, ticks, alpha, e,
               this.effect.getAmplitude(), this.effect.getAmplitudeAcceleration(),
               this.effect.getFrequency(), this.effect.getFrequencyAcceleration(),
               this.effect.getCompression(), this.effect.getCompressionAcceleration(),
               this.effect.getSpeed());
    }

    /*
        Evaluates the distortion effect at the given destination line and
        time value and returns the computed offset value.
        
        If the distortion mode is horizontal, this offset should be interpreted
        as the number of pixels to offset the given line's starting x position.
        
        If the distortion mode is vertical, this offset should be interpreted as
        the y-coordinate of the line from the source bitmap to draw at the given
        y-coordinate in the destination bitmap.
        
        @param y The y-coordinate of the destination line to evaluate for
        @param t The number of ticks since beginning animation
        @return The distortion offset for the given (y,t) coordinates
    */
    exports.getAppliedOffset = function(y, t, distortEffect, ampl, ampl_accel, s_freq, s_freq_accel, compr, compr_accel, speed) {
        var C1 = 1 / 512.0;
        var C2 = 8.0 * Math.PI  / (1024 * 256);
        var C3 = Math.PI  / 60.0;
        
        // Compute "current" values of amplitude, frequency, and compression
        var amplitude = (ampl + ampl_accel * t * 2);
        var frequency = (s_freq + s_freq_accel * t * 2);
        var compression = (compr + compr_accel * t * 2);

        // Compute the value of the sinusoidal line offset function
        var S = Math.floor(C1 * amplitude * Math.sin(C2 * frequency * y + C3 * speed * t));

        if (distortEffect == 1)
        {
            return S;
        }
        else if(distortEffect == 2)
        {
            return (y % 2) == 0? -S : S;
        }
        else if (distortEffect == 3)
        {
            var L = Math.floor(y * (1 + compression / 256.0) + S) % 256;
            if (L < 0) L = 256 + L;
            if (L > 255) L = 256 - L;

            return L;
        }

        return 0;
    }

    exports.ComputeFrame = function(dst, src, distortEffect, letterbox, ticks, alpha, erase, ampl, ampl_accel, s_freq, s_freq_accel, compr, compr_accel, speed) {
        var dbuf = new ArrayBuffer(dst.data.length);
        var dbuf8 = new Uint8ClampedArray(dbuf);
        var bdst = new Uint32Array(dbuf);

        var sbuf = new ArrayBuffer(dst.data.length);
        var sbuf8 = new Uint8ClampedArray(sbuf);
        var sdst = new Uint32Array(sbuf);

        // TODO: hardcoing is bad.
        var dstStride = 1024;
        var srcStride = 1024;

        /*
            Given the list of 4 distortions and the tick count, decide which
            effect to use:

            Basically, we have 4 effects, each possibly with a duration.

            Evaluation order is: 1, 2, 3, 0

            If the first effect is null, control transitions to the second effect.
            If the first and second effects are null, no effect occurs.
            If any other effect is null, the sequence is truncated.
            If a non-null effect has a zero duration, it will not be switched
            away from.

            Essentially, this configuration sets up a precise and repeating
            sequence of between 0 and 4 different distortion effects. Once we
            compute the sequence, computing the particular frame of which distortion
            to use becomes easy; simply mod the tick count by the total duration
            of the effects that are used in the sequence, then check the remainder
            against the cumulative durations of each effect.

            I guess the trick is to be sure that my description above is correct.

            Heh.
        */

        var x = 0, y = 0;

        for (y = 0; y < 224; y++)
        {
            S = this.getAppliedOffset(y, ticks, distortEffect, ampl, ampl_accel, s_freq, s_freq_accel, compr, compr_accel, speed); 
            L = y;

            if (distortEffect == 3) {
                L = S;
            }
            
            for (x = 0; x < 256; x++)
            {
                var bpos = x * 4 + y * dstStride;
                // if (y < letterbox || y > 224 - letterbox)
                // {
                //     bdst[bpos + 2 ] = 0;
                //     bdst[bpos + 1 ] = 0;
                //     bdst[bpos + 0 ] = 0;
                //     continue;
                // }
                var dx = x;

                if (distortEffect == 1
                        || distortEffect == 2)
                {
                    dx = (x + S) % 256;
                    if (dx < 0) dx = 256 + dx;
                    if (dx > 255) dx = 256 - dx;
                }

                var spos = dx * 4 + L * srcStride;

                // Either copy or add to the destination bitmap
                if (erase == 1)
                {
                    var value = x * y & 0xff;
                    var randomnumber=Math.floor(Math.random()*25)
                    // bdst[bpos] =
                    //     (255  ) |    // alpha
                    //     (value << randomnumber) |    // blue
                    //     (value <<  randomnumber) |    // green
                    //      value;            // red
                    bdst[bpos + 0 ] = 255;
                    bdst[bpos + 1 ] = value << randomnumber; //(alpha * bsrc[spos + 2 ]);
                    bdst[bpos + 2 ] = value << randomnumber; //(alpha * bsrc[spos + 1 ]);
                    bdst[bpos + 3 ] = value ; //(alpha * bsrc[spos + 0 ]);
                }
                else
                {
                    // bdst[bpos + 2 ] += (alpha * bsrc[spos + 2 ]);
                    // bdst[bpos + 1 ] += (alpha * bsrc[spos + 1 ]);
                    // bdst[bpos + 0 ] += (alpha * bsrc[spos + 0 ]);
                }
            }
        }

        return dbuf8;
    }

    exports.DistortionEffect = function() {
        var Type = {
            "Invalid": 0,
            "Horizontal": 1,
            "HorizontalInterlaced": 2,
            "Vertical": 3
        }

        var type;

        var ampl;
        var s_freq;
        var ampl_accel;
        var s_freq_accel;

        var start;
        var speed;

        var compr;
        var compr_accel;

        this.Type = function() {
            return Type;
        }

        this.getDistortionEffect = function() {
            return Type[type];
        }

        /**
         * Gets or sets the type of distortion effect to use.
         */
        this.getEffect = function() {
            return type;
        }

        this.getEffectAsInt = function() {
            return this.effect.getDistortionEffect();
        }

        this.setEffect = function(value) {
            type = value;
        }

        /**
         * Gets or sets the amplitude of the distortion effect
         */
        this.getAmplitude = function() {
            return ampl;
        }

        this.setAmplitude = function(value) {
            ampl = value;
        }

        /**
         * Gets or sets the spatial frequency of the distortion effect
         */
        this.getFrequency = function() {
            return s_freq;
        }

        this.setFrequency = function(value) {
            s_freq = value;
        }

        /**
         * The amount to add to the amplitude value every iteration.
         */
        this.getAmplitudeAcceleration = function() {
            return ampl_accel;
        }

        this.setAmplitudeAcceleration = function(value) {
            ampl_accel = value;
        }

        /**
         * The amount to add to the frequency value each iteration.
         */
        this.getFrequencyAcceleration = function() {
            return s_freq_accel;
        }

        this.setFrequencyAcceleration = function(value) {
            s_freq_accel = value;
        }

        /**
         * Compression factor
         */
        this.getCompression = function() {
            return compr;
        }

        this.setCompression = function(value) {
            compr = value;
        }

        /**
         * Change in the compression value every iteration
         */
        this.getCompressionAcceleration = function() {
            return compr_accel;
        }

        this.setCompressionAcceleration = function(value) {
            compr_accel = value;
        }

        /**
         * Offset for starting time.
         */
        this.getStartTime = function() {
            return start;
        }

        this.setStartTime = function(value) {
            start = value;
        }

        /**
         * Gets or sets the "speed" of the distortion. 0 = no animation, 127 =
         * very fast, 255 = very slow for some reason
         */
        this.getSpeed = function() {
            return speed;
        }

        this.setSpeed = function(value) {
            speed = value;
        }

        return this;
    }

}).call(Distorter.prototype);

});