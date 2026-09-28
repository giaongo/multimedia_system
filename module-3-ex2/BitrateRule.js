/**
 * The copyright in this software is being made available under the BSD License,
 * included below. This software may be subject to other third party and contributor
 * rights, including patent rights, and no such rights are granted under this license.
 *
 * Copyright (c) 2013, Dash Industry Forum.
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without modification,
 * are permitted provided that the following conditions are met:
 *  * Redistributions of source code must retain the above copyright notice, this
 *  list of conditions and the following disclaimer.
 *  * Redistributions in binary form must reproduce the above copyright notice,
 *  this list of conditions and the following disclaimer in the documentation and/or
 *  other materials provided with the distribution.
 *  * Neither the name of Dash Industry Forum nor the names of its
 *  contributors may be used to endorse or promote products derived from this software
 *  without specific prior written permission.
 *
 *  THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS AS IS AND ANY
 *  EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 *  WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED.
 *  IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT,
 *  INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT
 *  NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
 *  PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY,
 *  WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 *  ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
 *  POSSIBILITY OF SUCH DAMAGE.
 */

var BitrateRule;

function BitrateRuleClass() {
    let context = this.context;
    let factory = dashjs.FactoryMaker;
    let SwitchRequest = factory.getClassFactoryByName("SwitchRequest");
    let MetricsModel = factory.getSingletonFactoryByName("MetricsModel");
    let instance;

    // Keep some state between calls
    let lastQuality = null;
    let lastSwitchTime = 0;

    let throughputSafety = 0.85
    const EMERGENCY_BUFFER = 3;
    const LOW_BUFFER = 5;
    const HIGH_BUFFER = 8.5;

    // Wait this long before another UP switch
    const UP_SWITCH_COOLDOWN_MS = 14000;

    // Gets called when the rule is created
    function setup() {
        console.log("Rule Created");
    }

    // This function gets called periodically by the player to decide which quality to choose for next segment request
    // Do not rename this function but you can create other functions and call them from within this one
    function getSwitchRequest(rulesContext) {
        let metricsModel = MetricsModel(context).getInstance();
        var mediaType = rulesContext.getMediaInfo().type;
        var metrics = metricsModel.getMetricsFor(mediaType, true);

        //This is how you get current value of average download throughput (NB: the units are kbit/s)
        //The throughput estimates are configured to use sliding window moving average in the grader, see http://cdn.dashjs.org/latest/jsdoc/module-Settings.html#~AbrSettings
        let tput = player.getAverageThroughput(mediaType);

        //This is how you can sample current buffer occupancy (NB: the units are seconds)
        //The target buffer is set to 10s in the grader, so the player won't attempt to buffer more than that
        let bufferLevel = player.getDashMetrics().getCurrentBufferLevel("video");

        //You can also use other things you find in metrics
        console.log(metrics);

        // This is how you get the ABR controller
        // It is used to get the current representation and to switch to a new one
        let abrController = rulesContext.getAbrController();

        // This is how you get the bitrate list for the current media type
        let bitrateList = rulesContext.getMediaInfo()["bitrateList"];

        // This is how you get current quality index
        const currentRep = rulesContext.getRepresentation();
        const currentQuality = bitrateList.findIndex(r => r.id === currentRep.id);
        let quality;

        // Target bandwidth of the current chosen quality can be obtained like this (NB: bandwidth units are bit/s):
        let bandwidth = bitrateList[currentQuality].bandwidth;

        //  TODO: Write your bitrate switching logic here. 
        // 	Assign the chosen quality index to some variable (here we use "quality").
        // 	Then use that index to find the target bitrate in the bitrate list.
        //  Finally, pass the target bitrate to the ABR controller to change the representation.
        //	You can print to console as shown above and below and see the output in console of the browser developer tools.
        //  To avoid frequent switching between two bitrates, you may want to consider smoothing your quality switches (e.g. using EMA filter) and/or use some throughput safety margin too.
        quality = currentQuality


        // Find the highest bitrate that is safe according to the current throughput estimate
        if (bufferLevel > HIGH_BUFFER) {
            throughputSafety = 1.05
        } else if (bufferLevel >= LOW_BUFFER) {
            throughputSafety = 0.95
        } else {
            throughputSafety = 0.80
        }

        const safeThroughput = tput * throughputSafety

        let throughputQuality = 0;

        for (let i = 0; i < bitrateList.length; i++) {
            const bitrateKbit = bitrateList[i].bandwidth / 1000;

            if (bitrateKbit <= safeThroughput) {
                throughputQuality = i;
            }
        }

        // Buffer based protection
        if (bufferLevel < EMERGENCY_BUFFER) {
            // Buffer is closed to empty -> React quickly
            quality = Math.min(currentQuality, throughputQuality)
        } else if (bufferLevel < LOW_BUFFER) {
            quality = Math.min(currentQuality, throughputQuality);

        } else {
            // Buffer is healthy
            if (throughputQuality < currentQuality) {
                /*
                 * Don't react to every small throughput fluctuation
                 * when we still have plenty of buffer.
                 */
                const severeThroughputDrop = tput < currentBitrateKbit * 0.75;
                if (bufferLevel < 7 || severeThroughputDrop) {
                    quality = throughputQuality;
                } else {
                    quality = currentQuality;
                }
            } else if (throughputQuality > currentQuality && bufferLevel >= HIGH_BUFFER) {
                // Network seems capable of more and high buffer -> Increase slowly: at most 1 quality step
                const now = Date.now()
                if (now - lastSwitchTime >= UP_SWITCH_COOLDOWN_MS) {
                    /*
                     * Jump directly to the throughput-supported level.
                     *
                     * This avoids:
                     * 150 -> 300 -> 500 -> 900
                     *
                     * which counts as multiple switches.
                     */
                    quality = throughputQuality;
                }
            }
        }

        // Record actual switch
        if (lastQuality === null) {
            lastQuality = currentQuality;
        }

        if (quality !== currentQuality) {
            lastSwitchTime = Date.now();
            lastQuality = quality;
        }

        console.log({
            throughput: tput,
            safeThroughput,
            bufferLevel,
            currentQuality,
            throughputQuality,
            chosenQuality: quality,
            chosenBitrate: bitrateList[quality].bandwidth / 1000
        });


        // Alternatively, send quality switch request
        console.log(
            "Switching bitrate to " +
            rulesContext.getMediaInfo()["bitrateList"][quality]["bandwidth"]
        );

        // Pass the target bitrate to the ABR controller to change the representation.
        // NB: the target bitrate is in kbit/s, so we divide by 1000
        const targetKbit = bitrateList[quality].bandwidth / 1000;
        const newRepresentation = abrController.getOptimalRepresentationForBitrate(rulesContext.getMediaInfo(), targetKbit, true);

        switchRequest = SwitchRequest(context).create();
        switchRequest.representation = newRepresentation;
        switchRequest.reason = "some textual description";
        switchRequest.priority = SwitchRequest.PRIORITY.STRONG;

        return switchRequest;
    }

    instance = {
        getSwitchRequest
    };

    setup();

    return instance;
}

BitrateRuleClass.__dashjs_factory_name = "BitrateRule";
BitrateRule = dashjs.FactoryMaker.getClassFactory(BitrateRuleClass);