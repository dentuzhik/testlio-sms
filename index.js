exports.handler = function(event, context) {
    console.log('Hello World! Time remaining: ', context.getRemainingTimeInMillis());
    console.log('This is a sample message to test deployment for Julia!');
};
