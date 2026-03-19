'use strict';

const express = require('express');
const router = express.Router();
require('./mount-routes')(router);
module.exports = router;
