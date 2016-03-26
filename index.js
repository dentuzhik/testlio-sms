exports.handler = function(event, context) {
    console.log('Hello World! Time remaining: ', context.getRemainingTimeInMillis());
};
