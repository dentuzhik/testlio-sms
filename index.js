exports.handler = function(event, context) {
    console.log(event, context.getRemainingTimeInMillis());
};
