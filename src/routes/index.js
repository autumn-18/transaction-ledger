const express = require('express');
const accountRoutes = require('./account.routes');
const transferRoutes = require('./transfer.routes');

const router = express.Router();

router.use('/accounts', accountRoutes);
router.use('/transfers', transferRoutes);

module.exports = router;
