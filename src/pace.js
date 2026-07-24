function parseTimeToMinutes(token) {
  var m = /^(-)?(\d{1,3}):(\d{2})$/.exec(String(token).trim());
  if (!m) return null;
  var sign = m[1] ? -1 : 1;
  var hours = parseInt(m[2], 10);
  var mins = parseInt(m[3], 10);
  return sign * (hours * 60 + mins);
}

function extractRequiredRemainingMinutes(widgetText) {
  var matches = String(widgetText).match(/-?\d{1,3}:\d{2}/g);
  if (!matches) return null;
  for (var i = 0; i < matches.length; i++) {
    var value = parseTimeToMinutes(matches[i]);
    if (value !== null && value < 0) {
      return Math.abs(value);
    }
  }
  return null;
}

var FlexPacerLib = {
  parseTimeToMinutes: parseTimeToMinutes,
  extractRequiredRemainingMinutes: extractRequiredRemainingMinutes,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = FlexPacerLib;
} else {
  (typeof window !== 'undefined' ? window : globalThis).FlexPacerLib = FlexPacerLib;
}
