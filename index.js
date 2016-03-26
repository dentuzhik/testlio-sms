var _ = require('lodash');

function tryToKillHandler(event, context) {
    var KILL_MARKER = 'KILL';

    if (_.get(event, 'Records.0.Sns.Message') === KILL_MARKER) {
        context.done(null, {
            message: 'Successfully killed handler: ' + context.invokedFunctionArn
        });
    }
}

exports.handler = function(event, context) {
    // Check if Lambda execution should be killed
    // This is required so polling of SQS won't go forever and consume all the Quota
    tryToKillHandler(event, context);
};
