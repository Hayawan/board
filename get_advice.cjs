const fs = require('fs');

const data = JSON.parse(fs.readFileSync('./bookmarks.json', 'utf8'));

const strings = data
    .filter(item => typeof item.reflection.apply_to_naruki === 'string')
    .map(item => item.reflection.apply_to_naruki);

return strings