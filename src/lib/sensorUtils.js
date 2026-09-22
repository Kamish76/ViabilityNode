"use strict";
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.HARDCODED_CALIBRATION = void 0;
exports.calculateMoisturePct = calculateMoisturePct;
exports.medianFilter = medianFilter;
exports.detectWateringEvents = detectWateringEvents;
exports.HARDCODED_CALIBRATION = {
    dryLimit: 1920,
    wetLimit: 810,
};
function calculateMoisturePct(rawADC) {
    var dryLimit = exports.HARDCODED_CALIBRATION.dryLimit, wetLimit = exports.HARDCODED_CALIBRATION.wetLimit;
    if (dryLimit === wetLimit)
        return 0;
    var pct = ((dryLimit - rawADC) / (dryLimit - wetLimit)) * 100;
    return Math.max(0, Math.min(100, pct));
}
/**
 * Apply a lightweight median filter (window size 3) to strip ADC glitches.
 */
function medianFilter(data) {
    return data.map(function (d, i) {
        var win = data.slice(Math.max(0, i - 1), Math.min(data.length, i + 2));
        var vals = win.map(function (w) { return w.moisture_pct; }).sort(function (a, b) { return a - b; });
        return __assign(__assign({}, d), { moisture_pct: vals[Math.floor(vals.length / 2)] });
    });
}
/**
 * Detect watering events — significant moisture spikes.
 */
function detectWateringEvents(data, spikeThreshold, searchWindowMs // 4 hours
) {
    if (spikeThreshold === void 0) { spikeThreshold = 10; }
    if (searchWindowMs === void 0) { searchWindowMs = 4 * 60 * 60 * 1000; }
    var events = [];
    for (var i = 1; i < data.length; i++) {
        var delta = data[i].moisture_pct - data[i - 1].moisture_pct;
        if (delta >= spikeThreshold) {
            var spikeTime = new Date(data[i].recorded_at).getTime();
            var searchEnd = spikeTime + searchWindowMs;
            var peakIdx = i;
            var peakVal = data[i].moisture_pct;
            for (var j = i; j < data.length; j++) {
                var t = new Date(data[j].recorded_at).getTime();
                if (t > searchEnd)
                    break;
                if (data[j].moisture_pct > peakVal) {
                    peakVal = data[j].moisture_pct;
                    peakIdx = j;
                }
            }
            // Avoid duplicates for the same event
            var lastEvent = events[events.length - 1];
            if (!lastEvent || peakIdx !== lastEvent.peakIdx) {
                events.push({
                    spikeIdx: i,
                    peakIdx: peakIdx,
                    peakMoisture: peakVal,
                    peakTimestamp: data[peakIdx].recorded_at,
                });
            }
        }
    }
    return events;
}
