module.exports = {
    context: __dirname,
    entry: { 
        accessor: './accessors.ts',
        symbol: './symbol.ts'
    },
    output: {
        path: __dirname,
        filename: 'bundle.js'
    },
    resolve: {
        extensions: ['', '.js', '.ts']
    },
    module: {
        loaders: [
            { test: /\.ts$/, loader: '../../index.js?instance=targetES6&configFileName=es6.tsconfig.json' }
        ]
    }
}